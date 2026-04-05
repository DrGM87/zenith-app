# -*- coding: utf-8 -*-

"""
Sci-Hub Unofficial API — Zenith Edition
Downloads research papers from Sci-Hub mirrors using BeautifulSoup.

Based on original work by @zaytoun, rewritten for modern Sci-Hub (2024+).
Sci-Hub now uses <object type="application/pdf"> instead of <iframe>.
"""

import re
import hashlib
import logging
import os

import requests
import urllib3
from bs4 import BeautifulSoup

# log config
logging.basicConfig()
logger = logging.getLogger('Sci-Hub')
logger.setLevel(logging.DEBUG)

urllib3.disable_warnings()

# ── Constants ──

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

# Ordered by reliability — tested April 2026
SCIHUB_MIRRORS = [
    "https://sci-hub.ru",
    "https://sci-hub.st",
    "https://sci-hub.se",
    "https://sci-hub.su",
    "https://sci-hub.box",
    "https://sci-hub.red",
    "https://sci-hub.al",
    "https://sci-hub.mk",
    "https://sci-hub.ee",
    "https://sci-hub.in",
    "https://sci-hub.shop",
]


class CaptchaNeedException(Exception):
    pass


class SciHub:
    """
    Downloads papers from Sci-Hub given a DOI, PMID, or URL.
    Uses BeautifulSoup to extract the PDF URL from the page.
    """

    def __init__(self, mirrors=None, timeout=30):
        self.sess = requests.Session()
        self.sess.headers.update(HEADERS)
        self.mirrors = list(mirrors or SCIHUB_MIRRORS)
        self.timeout = timeout
        self.base_url = self.mirrors[0]

    def set_proxy(self, proxy):
        if proxy:
            self.sess.proxies = {"http": proxy, "https": proxy}

    # ── Core: extract PDF URL from Sci-Hub HTML using BS4 ──

    @staticmethod
    def extract_pdf_url(html, mirror):
        """
        Parse Sci-Hub HTML with BeautifulSoup and extract the PDF URL.
        Returns (pdf_url, captcha_info) where captcha_info is None on success.

        Sci-Hub embeds PDFs in several ways (checked in order):
          1. <object type="application/pdf" data="...">  (current, 2024+)
          2. <embed src="...">
          3. <iframe src="...">
          4. JS: url property in fetch('/live', ...) call
          5. Direct <a> link to .pdf
        """
        soup = BeautifulSoup(html, 'html.parser')

        # ── Check for CAPTCHA first ──
        captcha_img = soup.find('img', id='captcha')
        if not captcha_img:
            captcha_img = soup.find('img', src=re.compile(r'captcha', re.I))
        captcha_form = soup.find('form', string=re.compile(r'captcha', re.I)) if captcha_img else None
        if not captcha_form and captcha_img:
            captcha_form = captcha_img.find_parent('form')

        if captcha_img and captcha_form:
            action = captcha_form.get('action', '')
            img_src = captcha_img.get('src', '')
            return None, {
                "captcha_img_url": SciHub._fix_url(img_src, mirror),
                "form_action": SciHub._fix_url(action, mirror) if action else "",
            }

        # ── Strategy 1: <object type="application/pdf" data="..."> ──
        obj_tag = soup.find('object', attrs={'type': 'application/pdf'})
        if obj_tag and obj_tag.get('data'):
            url = obj_tag['data'].split('#')[0]  # strip #navpanes=0&view=FitH
            if url:
                return SciHub._fix_url(url, mirror), None

        # ── Strategy 2: <embed src="..."> ──
        embed_tag = soup.find('embed', src=True)
        if embed_tag:
            url = embed_tag['src'].split('#')[0]
            if '.pdf' in url or '/storage/' in url or '/downloads/' in url:
                return SciHub._fix_url(url, mirror), None

        # ── Strategy 3: <iframe src="..."> ──
        iframe_tag = soup.find('iframe', src=True)
        if iframe_tag:
            url = iframe_tag['src'].split('#')[0]
            if url:
                return SciHub._fix_url(url, mirror), None

        # ── Strategy 4: Extract from inline JS (fetch('/live', {body: JSON.stringify({url: '...'})})) ──
        for script in soup.find_all('script'):
            text = script.string or ''
            # Match: url: '/storage/...' or "url": "/storage/..."
            m = re.search(r'''['"]?url['"]?\s*:\s*['"]([^'"]+\.pdf[^'"]*)['"]''', text)
            if m:
                url = m.group(1).split('#')[0]
                return SciHub._fix_url(url, mirror), None

        # ── Strategy 5: Direct link to .pdf ──
        for a_tag in soup.find_all('a', href=True):
            href = a_tag['href']
            if '.pdf' in href and ('storage' in href or 'download' in href):
                return SciHub._fix_url(href, mirror), None

        # ── Strategy 6: Any URL ending in .pdf in the raw HTML (regex fallback) ──
        m = re.search(r'(https?://[^\s"\'<>]+\.pdf)', html)
        if m:
            return m.group(1), None

        return None, None

    @staticmethod
    def _fix_url(url, mirror):
        """Convert relative URL to absolute."""
        if not url:
            return url
        if url.startswith('//'):
            return 'https:' + url
        if url.startswith('/'):
            return mirror.rstrip('/') + url
        if not url.startswith('http'):
            return mirror.rstrip('/') + '/' + url
        return url

    @staticmethod
    def validate_pdf(content):
        """Check if bytes are a valid PDF (header + minimum size)."""
        if not content or len(content) < 1024:
            return False, "File too small (%d bytes)" % (len(content) if content else 0)
        if content[:5] != b'%PDF-':
            return False, "Not a PDF (header: %s)" % repr(content[:20])
        if content.rstrip()[-5:] != b'%%EOF' and b'%%EOF' not in content[-1024:]:
            # Some PDFs have trailing whitespace but should contain %%EOF near the end
            logger.warning("PDF missing %%EOF marker — may be truncated")
        return True, "ok"

    # ── Fetch ──

    def fetch(self, identifier):
        """
        Fetch a paper PDF from Sci-Hub.
        Returns dict: {pdf, url, name, mirror} on success, {err} on failure.
        Tries every mirror until one works.
        """
        errors = []

        for mirror in self.mirrors:
            try:
                page_url = mirror.rstrip('/') + '/' + identifier
                logger.info("Trying %s", page_url)

                resp = self.sess.get(page_url, timeout=self.timeout, verify=False)

                if resp.status_code == 403:
                    errors.append(f"{mirror}: 403 Forbidden")
                    continue
                if resp.status_code != 200:
                    errors.append(f"{mirror}: HTTP {resp.status_code}")
                    continue
                if len(resp.text) < 200:
                    errors.append(f"{mirror}: empty response")
                    continue
                if 'article not found' in resp.text.lower():
                    errors.append(f"{mirror}: article not found")
                    continue

                # Check if response is already a PDF (some mirrors redirect directly)
                ct = resp.headers.get('Content-Type', '')
                if 'application/pdf' in ct and resp.content[:5] == b'%PDF-':
                    valid, msg = self.validate_pdf(resp.content)
                    if valid:
                        return {
                            'pdf': resp.content,
                            'url': page_url,
                            'name': self._generate_name_from_doi(identifier),
                            'mirror': mirror,
                        }

                # Parse HTML to find PDF URL
                pdf_url, captcha_info = self.extract_pdf_url(resp.text, mirror)

                if captcha_info:
                    errors.append(f"{mirror}: CAPTCHA required")
                    continue

                if not pdf_url:
                    errors.append(f"{mirror}: could not find PDF URL in page")
                    continue

                # Download the actual PDF
                logger.info("Downloading PDF from %s", pdf_url)
                pdf_resp = self.sess.get(pdf_url, timeout=self.timeout, verify=False)

                valid, msg = self.validate_pdf(pdf_resp.content)
                if not valid:
                    errors.append(f"{mirror}: {msg}")
                    continue

                return {
                    'pdf': pdf_resp.content,
                    'url': pdf_url,
                    'name': self._generate_name(pdf_resp),
                    'mirror': mirror,
                }

            except requests.exceptions.Timeout:
                errors.append(f"{mirror}: timeout")
            except requests.exceptions.ConnectionError as e:
                errors.append(f"{mirror}: connection error")
            except Exception as e:
                errors.append(f"{mirror}: {type(e).__name__}: {e}")

        error_summary = "; ".join(errors) if errors else "no mirrors available"
        return {'err': f'Failed to fetch {identifier}: {error_summary}'}

    def download(self, identifier, destination='', path=None):
        """Download a paper and save to disk."""
        data = self.fetch(identifier)
        if 'err' not in data:
            save_path = os.path.join(destination, path if path else data['name'])
            self._save(data['pdf'], save_path)
            data['path'] = save_path
        return data

    # ── Helpers ──

    @staticmethod
    def _generate_name(res):
        name = res.url.split('/')[-1].split('#')[0].split('?')[0]
        name = re.sub(r'[^a-zA-Z0-9_.-]', '_', name)
        pdf_hash = hashlib.md5(res.content).hexdigest()[:8]
        return f'{pdf_hash}-{name[-40:]}'

    @staticmethod
    def _generate_name_from_doi(doi):
        safe = re.sub(r'[^a-zA-Z0-9_.-]', '_', doi)
        return f'scihub_{safe}.pdf'

    @staticmethod
    def _save(data, path):
        os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
        with open(path, 'wb') as f:
            f.write(data)

    @staticmethod
    def _get_soup(html):
        return BeautifulSoup(html if isinstance(html, str) else html.decode('utf-8', errors='replace'),
                             'html.parser')


def main():
    import argparse
    sh = SciHub()

    parser = argparse.ArgumentParser(description='SciHub - Remove all barriers in the way of science.')
    parser.add_argument('-d', '--download', metavar='(DOI|PMID|URL)',
                        help='tries to find and download the paper', type=str)
    parser.add_argument('-f', '--file', metavar='path',
                        help='pass file with list of identifiers and download each', type=str)
    parser.add_argument('-o', '--output', metavar='path',
                        help='directory to store papers', default='', type=str)
    parser.add_argument('-v', '--verbose', help='increase output verbosity', action='store_true')
    parser.add_argument('-p', '--proxy',
                        help='via proxy format like socks5://user:pass@host:port', type=str)

    args = parser.parse_args()

    if args.verbose:
        logger.setLevel(logging.DEBUG)
    if args.proxy:
        sh.set_proxy(args.proxy)

    if args.download:
        result = sh.download(args.download, args.output)
        if 'err' in result:
            logger.error('%s', result['err'])
        else:
            logger.info('Downloaded: %s', result.get('path', result.get('name')))
    elif args.file:
        with open(args.file, 'r') as f:
            for identifier in f.read().splitlines():
                identifier = identifier.strip()
                if not identifier:
                    continue
                result = sh.download(identifier, args.output)
                if 'err' in result:
                    logger.error('%s', result['err'])
                else:
                    logger.info('Downloaded: %s', result.get('path', result.get('name')))


if __name__ == '__main__':
    main()
