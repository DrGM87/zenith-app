#!/usr/bin/python3
# -*- encoding: Utf-8 -*-
"""
Shazam audio fingerprinting and recognition module for Zenith.

Core algorithm adapted from SongRec by marin-m (https://github.com/marin-m/SongRec)
Licensed under GPL-3.0. See reference/SongRec/LICENSE for full terms.

This module provides:
  - SignatureGenerator: generates Shazam-compatible audio fingerprints from PCM data
  - recognize_song_from_signature: sends fingerprint to Shazam API and returns metadata
  - recognize_file: high-level function to recognize a song from an audio file path

Windows-compatible. Requires: numpy, pydub (+ ffmpeg in PATH or bundled), requests
"""

import sys
import json
import struct
from io import BytesIO
from enum import IntEnum
from copy import copy
from math import log as math_log, exp, sqrt
from typing import Dict, List, Optional, Any
from binascii import crc32
from base64 import b64decode, b64encode
from ctypes import LittleEndianStructure, c_uint32
from uuid import uuid5, getnode, NAMESPACE_DNS, NAMESPACE_URL
from random import seed, random, choice
from time import time

import numpy as np
from numpy import fft

# ─── Constants ───────────────────────────────────────────────────────────────

HANNING_MATRIX = np.hanning(2050)[1:-1]  # 2048 values, no leading/trailing zeros

DATA_URI_PREFIX = "data:audio/vnd.shazam.sig;base64,"

USER_AGENTS = [
    "Dalvik/2.1.0 (Linux; U; Android 5.0.2; VS980 4G Build/LRX22G)",
    "Dalvik/1.6.0 (Linux; U; Android 4.4.2; SM-T210 Build/KOT49H)",
    "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-P905V Build/LMY47X)",
    "Dalvik/2.1.0 (Linux; U; Android 5.0.2; SM-S920L Build/LRX22G)",
    "Dalvik/2.1.0 (Linux; U; Android 5.0; Fire Pro Build/LRX21M)",
    "Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G920F Build/MMB29K)",
    "Dalvik/2.1.0 (Linux; U; Android 5.0; SM-G900F Build/LRX21T)",
    "Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G928F Build/MMB29K)",
    "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-J500FN Build/LMY48B)",
    "Dalvik/1.6.0 (Linux; U; Android 4.4.4; SM-J110F Build/KTU84P)",
    "Dalvik/2.1.0 (Linux; U; Android 6.0.1; D6603 Build/23.5.A.0.570)",
    "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-J700H Build/LMY48B)",
    "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-N910G Build/LMY47X)",
]

# ─── Enums ───────────────────────────────────────────────────────────────────

class SampleRate(IntEnum):
    _8000 = 1
    _11025 = 2
    _16000 = 3
    _32000 = 4
    _44100 = 5
    _48000 = 6

class FrequencyBand(IntEnum):
    _0_250 = -1
    _250_520 = 0
    _520_1450 = 1
    _1450_3500 = 2
    _3500_5500 = 3

# ─── Signature Format ────────────────────────────────────────────────────────

class RawSignatureHeader(LittleEndianStructure):
    _pack_ = True
    _fields_ = [
        ("magic1", c_uint32),
        ("crc32", c_uint32),
        ("size_minus_header", c_uint32),
        ("magic2", c_uint32),
        ("void1", c_uint32 * 3),
        ("shifted_sample_rate_id", c_uint32),
        ("void2", c_uint32 * 2),
        ("number_samples_plus_divided_sample_rate", c_uint32),
        ("fixed_value", c_uint32),
    ]

class FrequencyPeak:
    def __init__(self, fft_pass_number: int, peak_magnitude: int,
                 corrected_peak_frequency_bin: int, sample_rate_hz: int):
        self.fft_pass_number = fft_pass_number
        self.peak_magnitude = peak_magnitude
        self.corrected_peak_frequency_bin = corrected_peak_frequency_bin
        self.sample_rate_hz = sample_rate_hz

    def get_frequency_hz(self) -> float:
        return self.corrected_peak_frequency_bin * (self.sample_rate_hz / 2 / 1024 / 64)

    def get_seconds(self) -> float:
        return (self.fft_pass_number * 128) / self.sample_rate_hz


class DecodedMessage:
    def __init__(self):
        self.sample_rate_hz: int = 0
        self.number_samples: int = 0
        self.frequency_band_to_sound_peaks: Dict[FrequencyBand, List[FrequencyPeak]] = {}

    def encode_to_binary(self) -> bytes:
        header = RawSignatureHeader()
        header.magic1 = 0xCAFE2580
        header.magic2 = 0x94119C00
        header.shifted_sample_rate_id = int(getattr(SampleRate, "_%s" % self.sample_rate_hz)) << 27
        header.fixed_value = (15 << 19) + 0x40000
        header.number_samples_plus_divided_sample_rate = int(
            self.number_samples + self.sample_rate_hz * 0.24
        )

        contents_buf = BytesIO()
        for frequency_band, frequency_peaks in sorted(self.frequency_band_to_sound_peaks.items()):
            peaks_buf = BytesIO()
            fft_pass_number = 0
            for fp in frequency_peaks:
                assert fp.fft_pass_number >= fft_pass_number
                if fp.fft_pass_number - fft_pass_number >= 255:
                    peaks_buf.write(b"\xff")
                    peaks_buf.write(fp.fft_pass_number.to_bytes(4, "little"))
                    fft_pass_number = fp.fft_pass_number
                peaks_buf.write(bytes([fp.fft_pass_number - fft_pass_number]))
                peaks_buf.write(fp.peak_magnitude.to_bytes(2, "little"))
                peaks_buf.write(fp.corrected_peak_frequency_bin.to_bytes(2, "little"))
                fft_pass_number = fp.fft_pass_number

            contents_buf.write((0x60030040 + int(frequency_band)).to_bytes(4, "little"))
            contents_buf.write(len(peaks_buf.getvalue()).to_bytes(4, "little"))
            contents_buf.write(peaks_buf.getvalue())
            contents_buf.write(b"\x00" * (-len(peaks_buf.getvalue()) % 4))

        header.size_minus_header = len(contents_buf.getvalue()) + 8
        buf = BytesIO()
        buf.write(bytes(header))
        buf.write((0x40000000).to_bytes(4, "little"))
        buf.write((len(contents_buf.getvalue()) + 8).to_bytes(4, "little"))
        buf.write(contents_buf.getvalue())

        buf.seek(8)
        header.crc32 = crc32(buf.read()) & 0xFFFFFFFF
        buf.seek(0)
        buf.write(bytes(header))
        return buf.getvalue()

    def encode_to_uri(self) -> str:
        return DATA_URI_PREFIX + b64encode(self.encode_to_binary()).decode("ascii")


# ─── Ring Buffer ─────────────────────────────────────────────────────────────

class RingBuffer(list):
    def __init__(self, buffer_size: int, default_value: Any = None):
        if default_value is not None:
            list.__init__(self, [copy(default_value) for _ in range(buffer_size)])
        else:
            list.__init__(self, [None] * buffer_size)
        self.position: int = 0
        self.buffer_size: int = buffer_size
        self.num_written: int = 0

    def append(self, value: Any):
        self[self.position] = value
        self.position += 1
        self.position %= self.buffer_size
        self.num_written += 1


# ─── Signature Generator (Core Fingerprinting Algorithm) ─────────────────────

class SignatureGenerator:
    """
    Generates Shazam-compatible audio fingerprints from 16-bit 16KHz mono PCM.

    Algorithm: Windowed FFT → peak spreading (frequency + time domain) →
    peak recognition → frequency band classification → signature encoding.
    """

    def __init__(self):
        self.input_pending_processing: List[int] = []
        self.samples_processed: int = 0

        self.ring_buffer_of_samples = RingBuffer(buffer_size=2048, default_value=0)
        self.fft_outputs = RingBuffer(buffer_size=256, default_value=[0.0 * 1025])
        self.spread_ffts_output = RingBuffer(buffer_size=256, default_value=[0] * 1025)

        self.MAX_TIME_SECONDS = 3.1
        self.MAX_PEAKS = 255

        self.next_signature = DecodedMessage()
        self.next_signature.sample_rate_hz = 16000
        self.next_signature.number_samples = 0
        self.next_signature.frequency_band_to_sound_peaks = {}

    def feed_input(self, s16le_mono_samples: List[int]):
        self.input_pending_processing += list(s16le_mono_samples)

    def get_next_signature(self) -> Optional[DecodedMessage]:
        if len(self.input_pending_processing) - self.samples_processed < 128:
            return None

        while (
            len(self.input_pending_processing) - self.samples_processed >= 128
            and (
                self.next_signature.number_samples / self.next_signature.sample_rate_hz
                < self.MAX_TIME_SECONDS
                or sum(
                    len(peaks)
                    for peaks in self.next_signature.frequency_band_to_sound_peaks.values()
                )
                < self.MAX_PEAKS
            )
        ):
            self.process_input(
                self.input_pending_processing[
                    self.samples_processed : self.samples_processed + 128
                ]
            )
            self.samples_processed += 128

        returned_signature = self.next_signature

        self.next_signature = DecodedMessage()
        self.next_signature.sample_rate_hz = 16000
        self.next_signature.number_samples = 0
        self.next_signature.frequency_band_to_sound_peaks = {}

        self.ring_buffer_of_samples = RingBuffer(buffer_size=2048, default_value=0)
        self.fft_outputs = RingBuffer(buffer_size=256, default_value=[0.0 * 1025])
        self.spread_ffts_output = RingBuffer(buffer_size=256, default_value=[0] * 1025)

        return returned_signature

    def process_input(self, s16le_mono_samples: List[int]):
        self.next_signature.number_samples += len(s16le_mono_samples)
        for pos in range(0, len(s16le_mono_samples), 128):
            self.do_fft(s16le_mono_samples[pos : pos + 128])
            self.do_peak_spreading_and_recognition()

    def do_fft(self, batch_of_128_s16le_mono_samples):
        self.ring_buffer_of_samples[
            self.ring_buffer_of_samples.position : self.ring_buffer_of_samples.position
            + len(batch_of_128_s16le_mono_samples)
        ] = batch_of_128_s16le_mono_samples

        self.ring_buffer_of_samples.position += len(batch_of_128_s16le_mono_samples)
        self.ring_buffer_of_samples.position %= 2048
        self.ring_buffer_of_samples.num_written += len(batch_of_128_s16le_mono_samples)

        excerpt = (
            self.ring_buffer_of_samples[self.ring_buffer_of_samples.position :]
            + self.ring_buffer_of_samples[: self.ring_buffer_of_samples.position]
        )

        fft_results = fft.rfft(HANNING_MATRIX * excerpt)
        fft_results = (fft_results.real ** 2 + fft_results.imag ** 2) / (1 << 17)
        fft_results = np.maximum(fft_results, 0.0000000001)
        self.fft_outputs.append(fft_results)

    def do_peak_spreading_and_recognition(self):
        self.do_peak_spreading()
        if self.spread_ffts_output.num_written >= 46:
            self.do_peak_recognition()

    def do_peak_spreading(self):
        origin_last_fft = self.fft_outputs[self.fft_outputs.position - 1]
        spread_last_fft = list(origin_last_fft)

        for position in range(1025):
            if position < 1023:
                spread_last_fft[position] = max(spread_last_fft[position : position + 3])
            max_value = spread_last_fft[position]
            for former_fft_num in [-1, -3, -6]:
                former_fft_output = self.spread_ffts_output[
                    (self.spread_ffts_output.position + former_fft_num)
                    % self.spread_ffts_output.buffer_size
                ]
                former_fft_output[position] = max_value = max(
                    former_fft_output[position], max_value
                )

        self.spread_ffts_output.append(spread_last_fft)

    def do_peak_recognition(self):
        fft_minus_46 = self.fft_outputs[
            (self.fft_outputs.position - 46) % self.fft_outputs.buffer_size
        ]
        fft_minus_49 = self.spread_ffts_output[
            (self.spread_ffts_output.position - 49) % self.spread_ffts_output.buffer_size
        ]
        fft_minus_53 = self.spread_ffts_output[
            (self.spread_ffts_output.position - 53) % self.spread_ffts_output.buffer_size
        ]
        fft_minus_45 = self.spread_ffts_output[
            (self.spread_ffts_output.position - 45) % self.spread_ffts_output.buffer_size
        ]

        for bin_position in range(10, 1015):
            if (
                fft_minus_46[bin_position] >= 1 / 64
                and fft_minus_46[bin_position] >= fft_minus_49[bin_position - 1]
            ):
                max_neighbor_in_fft_minus_49 = 0
                for neighbor_offset in [*range(-10, -3, 3), -3, 1, *range(2, 9, 3)]:
                    max_neighbor_in_fft_minus_49 = max(
                        fft_minus_49[bin_position + neighbor_offset],
                        max_neighbor_in_fft_minus_49,
                    )

                if fft_minus_46[bin_position] > max_neighbor_in_fft_minus_49:
                    max_neighbor_in_other_adjacent_ffts = max_neighbor_in_fft_minus_49
                    for other_offset in [
                        -53, -45,
                        *range(165, 201, 7),
                        *range(214, 250, 7),
                    ]:
                        max_neighbor_in_other_adjacent_ffts = max(
                            self.spread_ffts_output[
                                (self.spread_ffts_output.position + other_offset)
                                % self.spread_ffts_output.buffer_size
                            ][bin_position - 1],
                            max_neighbor_in_other_adjacent_ffts,
                        )

                    if fft_minus_46[bin_position] > max_neighbor_in_other_adjacent_ffts:
                        fft_number = self.spread_ffts_output.num_written - 46

                        peak_magnitude = (
                            np.log(max(1 / 64, fft_minus_46[bin_position])) * 1477.3 + 6144
                        )
                        peak_magnitude_before = (
                            np.log(max(1 / 64, fft_minus_46[bin_position - 1])) * 1477.3 + 6144
                        )
                        peak_magnitude_after = (
                            np.log(max(1 / 64, fft_minus_46[bin_position + 1])) * 1477.3 + 6144
                        )

                        peak_variation_1 = (
                            peak_magnitude * 2 - peak_magnitude_before - peak_magnitude_after
                        )
                        peak_variation_2 = (
                            (peak_magnitude_after - peak_magnitude_before) * 32 / peak_variation_1
                        )

                        corrected_peak_frequency_bin = bin_position * 64 + peak_variation_2

                        if peak_variation_1 <= 0:
                            continue

                        frequency_hz = corrected_peak_frequency_bin * (16000 / 2 / 1024 / 64)

                        if frequency_hz < 250:
                            continue
                        elif frequency_hz < 520:
                            band = FrequencyBand._250_520
                        elif frequency_hz < 1450:
                            band = FrequencyBand._520_1450
                        elif frequency_hz < 3500:
                            band = FrequencyBand._1450_3500
                        elif frequency_hz <= 5500:
                            band = FrequencyBand._3500_5500
                        else:
                            continue

                        if band not in self.next_signature.frequency_band_to_sound_peaks:
                            self.next_signature.frequency_band_to_sound_peaks[band] = []

                        self.next_signature.frequency_band_to_sound_peaks[band].append(
                            FrequencyPeak(
                                fft_number,
                                int(peak_magnitude),
                                int(corrected_peak_frequency_bin),
                                16000,
                            )
                        )


# ─── Shazam API Communication ────────────────────────────────────────────────

def recognize_song_from_signature(signature: DecodedMessage) -> dict:
    """Send a fingerprint to Shazam's API and return the recognition result."""
    import requests

    try:
        locale = __import__("locale").getlocale()[0] or "en_US"
        locale = locale.split(".")[0]
    except Exception:
        locale = "en_US"

    first_uuid = str(uuid5(NAMESPACE_DNS, str(getnode()))).upper()
    second_uuid = str(uuid5(NAMESPACE_URL, str(getnode())))

    fuzz = random() * 15.3 - 7.65
    seed(getnode())

    try:
        resp = requests.post(
            "https://amp.shazam.com/discovery/v5/fr/FR/android/-/tag/"
            + first_uuid + "/" + second_uuid,
            params={
                "sync": "true",
                "webv3": "true",
                "sampling": "true",
                "connected": "",
                "shazamapiversion": "v3",
                "sharehub": "true",
                "video": "v3",
            },
            headers={
                "Content-Type": "application/json",
                "User-Agent": choice(USER_AGENTS),
                "Content-Language": locale,
            },
            json={
                "geolocation": {
                    "altitude": random() * 400 + 100 + fuzz,
                    "latitude": random() * 180 - 90 + fuzz,
                    "longitude": random() * 360 - 180 + fuzz,
                },
                "signature": {
                    "samplems": int(
                        signature.number_samples / signature.sample_rate_hz * 1000
                    ),
                    "timestamp": int(time() * 1000),
                    "uri": signature.encode_to_uri(),
                },
                "timestamp": int(time() * 1000),
                "timezone": "Europe/Paris",
            },
            timeout=15,
        )
        return resp.json()
    except Exception as e:
        return {"matches": [], "error": str(e)}


# ─── High-Level Recognition Functions ────────────────────────────────────────

def _preprocess_mic_audio(audio):
    """Clean up microphone recording for better Shazam recognition."""
    import struct, math

    # Get raw samples
    audio = audio.set_frame_rate(16000).set_channels(1).set_sample_width(2)
    samples = list(audio.get_array_of_samples())

    # Remove DC offset
    mean_val = sum(samples) / len(samples)
    samples = [s - int(mean_val) for s in samples]

    # Trim leading/trailing silence (below 2% of max amplitude)
    max_amp = max(abs(s) for s in samples) if samples else 1
    threshold = int(max_amp * 0.03)
    # Find first non-silent sample
    start_idx = 0
    for i, s in enumerate(samples):
        if abs(s) > threshold:
            start_idx = max(0, i - 4000)  # keep 250ms before first sound
            break
    # Find last non-silent sample
    end_idx = len(samples)
    for i in range(len(samples) - 1, -1, -1):
        if abs(samples[i]) > threshold:
            end_idx = min(len(samples), i + 4000)  # keep 250ms after last sound
            break
    samples = samples[start_idx:end_idx]

    if len(samples) < 16000:
        # Too short after trimming, return original
        return audio

    # Normalize to 90% of max to boost quiet recordings
    peak = max(abs(s) for s in samples) if samples else 1
    if peak > 0 and peak < 16384:  # Only boost if quiet (less than 50% of max)
        gain = min(28000 / peak, 12.0)  # Up to 12x gain, capped at ~85% of 32767
        samples = [max(-28000, min(28000, int(s * gain))) for s in samples]

    # Apply gentle high-pass filter to reduce rumble (simple 1-pole IIR)
    # Cutoff ~80Hz at 16kHz: alpha = 0.969
    filtered = []
    prev_in = 0.0
    prev_out = 0.0
    alpha = 0.97
    for s in samples:
        s_float = float(s)
        out = alpha * (prev_out + s_float - prev_in)
        prev_in = s_float
        prev_out = out
        filtered.append(max(-32767, min(32767, int(out))))

    # Rebuild AudioSegment from processed samples
    raw_bytes = struct.pack('<' + 'h' * len(filtered), *filtered)
    from pydub import AudioSegment
    return AudioSegment(raw_bytes, sample_width=2, frame_rate=16000, channels=1)

def recognize_file(file_path: str, max_seconds: float = 12.0, mic_recording: bool = False) -> dict:
    """
    Recognize a song from an audio file.

    Args:
        file_path: Path to audio file (mp3, wav, flac, m4a, ogg, wma, etc.)
        max_seconds: Maximum seconds of audio to analyze per attempt.

    Returns:
        dict with keys:
            ok: bool
            title: str (song title)
            artist: str (artist name)
            album: str (album name, if available)
            year: str (release year, if available)
            genre: str (genre, if available)
            cover_url: str (cover art URL, if available)
            shazam_url: str (Shazam page URL)
            isrc: str (ISRC code if available)
            label: str (record label if available)
            raw: dict (full Shazam API response)
    """
    try:
        from pydub import AudioSegment
    except ImportError:
        return {"ok": False, "error": "pydub is required. Install: pip install pydub"}

    try:
        audio = AudioSegment.from_file(file_path)
    except Exception as e:
        return {"ok": False, "error": f"Could not read audio file: {e}"}

    # Preprocess microphone recordings: trim silence, normalize, filter
    if mic_recording:
        try:
            audio = _preprocess_mic_audio(audio)
        except Exception as e:
            return {"ok": False, "error": f"Preprocessing failed: {e}"}

    # Convert to 16-bit 16KHz mono PCM
    audio = audio.set_sample_width(2)
    audio = audio.set_frame_rate(16000)
    audio = audio.set_channels(1)

    sig_gen = SignatureGenerator()
    sig_gen.feed_input(list(audio.get_array_of_samples()))

    sig_gen.MAX_TIME_SECONDS = max_seconds

    # Start from middle of song for better recognition
    if audio.duration_seconds > max_seconds * 3:
        sig_gen.samples_processed += 16000 * (int(audio.duration_seconds / 2) - int(max_seconds / 2))

    attempts = 0
    max_attempts = 4

    while attempts < max_attempts:
        signature = sig_gen.get_next_signature()
        if not signature:
            break

        result = recognize_song_from_signature(signature)
        attempts += 1

        if result.get("matches"):
            return _parse_shazam_result(result)

    return {"ok": False, "error": "No match found", "attempts": attempts}


def _parse_shazam_result(raw: dict) -> dict:
    """Parse Shazam API response into a clean metadata dict."""
    out = {"ok": True, "raw": raw}

    track = raw.get("track", {})
    if not track:
        # Sometimes matches exist but track is nested differently
        matches = raw.get("matches", [])
        if matches:
            out["shazam_id"] = matches[0].get("id", "")

    out["title"] = track.get("title", "")
    out["artist"] = track.get("subtitle", "")
    out["shazam_url"] = track.get("url", "")
    out["shazam_key"] = track.get("key", "")

    # Album, genre, year, label from sections
    for section in track.get("sections", []):
        if section.get("type") == "SONG":
            for meta in section.get("metadata", []):
                title_lower = meta.get("title", "").lower()
                val = meta.get("text", "")
                if "album" in title_lower:
                    out["album"] = val
                elif "released" in title_lower or "year" in title_lower:
                    out["year"] = val
                elif "label" in title_lower:
                    out["label"] = val

        if section.get("type") == "LYRICS":
            out["has_lyrics"] = True

    # Genre
    for g in track.get("genres", {}).values():
        out["genre"] = g
        break

    # ISRC from hub actions
    hub = track.get("hub", {})
    for action in hub.get("options", []):
        for oa in action.get("actions", []):
            if oa.get("type") == "uri" and "isrc" in oa.get("uri", "").lower():
                out["isrc"] = oa.get("uri", "").split("isrc=")[-1].split("&")[0]

    # Cover art
    images = track.get("images", {})
    out["cover_url"] = images.get("coverarthq", images.get("coverart", ""))

    # Apple Music / Spotify links from hub
    for provider in hub.get("providers", []):
        ptype = provider.get("type", "").lower()
        for action in provider.get("actions", []):
            uri = action.get("uri", "")
            if ptype == "APPLEMUSIC" or "apple" in ptype:
                out["apple_music_url"] = uri
            elif "spotify" in ptype:
                out["spotify_url"] = uri

    return out


# ─── CLI Entry Point ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: shazam_recognize.py <audio_file>"}))
        sys.exit(1)

    result = recognize_file(sys.argv[1])
    # Strip raw response for CLI output (too verbose)
    if "raw" in result:
        del result["raw"]
    print(json.dumps(result, indent=2, ensure_ascii=False))
