"""
gRAG Integration Layer
========================

This module integrates the gRAG tools with the existing Zenith RAG_engine.py LLM API.
It provides a bridge between the GraphRAG-style tools and the existing embedding/LLM infrastructure.

Based on RAG_engine.py:
- Uses Google Gemini API for embeddings (models/gemini-embedding-2-preview)
- Uses local models via SentenceTransformer (nomic-ai/nomic-embed-text-v1.5)
- Provides set_gemini_api_key() function for API key management
- Routes embedding requests to appropriate model

Author: GraphRAG Python Tools
Version: 1.0.0
"""

import sys
import os
from typing import Optional

# Import from existing RAG_engine.py
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from RAG_engine import (
        set_gemini_api_key,
        _resolve_gemini_key,
        _embed_texts,
        EMBEDDING_MODELS,
        DEFAULT_EMBEDDING_MODEL,
        _GEMINI_MODEL,
    )
    _HAS_RAG_ENGINE = True
except ImportError as e:
    print(f"[gRAG Integration] Warning: Could not import RAG_engine: {e}")
    _HAS_RAG_ENGINE = False


class LLMAPIClient:
    """
    LLM API client that bridges gRAG tools with RAG_engine.py.
    
    This class provides a unified interface for gRAG tools to access the
    existing LLM and embedding functionality in RAG_engine.py.
    """
    
    def __init__(self, gemini_api_key: str = ""):
        """
        Initialize the LLM API client.
        
        Args:
            gemini_api_key: Google Gemini API key (optional, can be set via env var)
        """
        if not _HAS_RAG_ENGINE:
            raise RuntimeError("RAG_engine.py not available. Cannot initialize LLM API client.")
        
        if gemini_api_key:
            set_gemini_api_key(gemini_api_key)
        
        self.api_key = gemini_api_key or _resolve_gemini_key()
    
    def set_api_key(self, api_key: str) -> None:
        """
        Set the Gemini API key.
        
        Args:
            api_key: Google Gemini API key
        """
        set_gemini_api_key(api_key)
        self.api_key = api_key
    
    def get_api_key(self) -> str:
        """
        Get the current API key.
        
        Returns:
            str: Current API key
        """
        return self.api_key or _resolve_gemini_key()
    
    def embed_texts(
        self,
        texts: list,
        model_name: str = DEFAULT_EMBEDDING_MODEL,
        is_query: bool = False,
        progress_cb=None
    ) -> list:
        """
        Embed a list of texts using the configured model.
        
        Args:
            texts: List of text strings to embed
            model_name: Name of the embedding model to use
            is_query: Whether these are query texts (vs document texts)
            progress_cb: Optional progress callback function
            
        Returns:
            list: List of embedding vectors
        """
        if not _HAS_RAG_ENGINE:
            raise RuntimeError("RAG_engine.py not available. Cannot embed texts.")
        
        return _embed_texts(
            texts,
            model_name,
            is_query=is_query,
            gemini_api_key=self.api_key,
            progress_cb=progress_cb,
        )
    
    def get_available_models(self) -> dict:
        """
        Get available embedding models.
        
        Returns:
            dict: Dictionary of available embedding models
        """
        if not _HAS_RAG_ENGINE:
            return {}
        
        return EMBEDDING_MODELS
    
    def get_default_model(self) -> str:
        """
        Get the default embedding model.
        
        Returns:
            str: Default model name
        """
        if not _HAS_RAG_ENGINE:
            return "nomic-ai/nomic-embed-text-v1.5"
        
        return DEFAULT_EMBEDDING_MODEL
    
    def is_gemini_model(self, model_name: str) -> bool:
        """
        Check if a model is a Gemini API model.
        
        Args:
            model_name: Model name to check
            
        Returns:
            bool: True if model uses Gemini API
        """
        if not _HAS_RAG_ENGINE:
            return False
        
        return model_name == _GEMINI_MODEL


class CompletionAPIClient:
    """
    Completion API client for LLM text generation.
    
    This provides a bridge for gRAG tools to access LLM completion functionality.
    Currently uses Gemini API for completions.
    """
    
    def __init__(self, gemini_api_key: str = ""):
        """
        Initialize the completion API client.
        
        Args:
            gemini_api_key: Google Gemini API key
        """
        self.api_key = gemini_api_key or _resolve_gemini_key() if _HAS_RAG_ENGINE else ""
        
        try:
            from google import genai as _genai
            self.genai = _genai
            self.client = _genai.Client(api_key=self.api_key)
            self._has_genai = True
        except ImportError:
            self._has_genai = False
            print("[gRAG Integration] Warning: google-genai not available")
    
    def complete(
        self,
        prompt: str,
        model: str = "gemini-1.5-flash",
        temperature: float = 0.0,
        max_tokens: int = 1024,
        **kwargs
    ) -> str:
        """
        Generate a completion using the LLM.
        
        Args:
            prompt: The prompt to complete
            model: Model to use for completion
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            **kwargs: Additional model parameters
            
        Returns:
            str: Generated completion text
        """
        if not self._has_genai:
            raise RuntimeError("google-genai not available. Cannot generate completions.")
        
        response = self.client.models.generate_content(
            model=model,
            contents=prompt,
            config=self.genai.GenerateContentConfig(
                temperature=temperature,
                max_output_tokens=max_tokens,
                **kwargs
            )
        )
        
        return response.text
    
    def complete_json(
        self,
        prompt: str,
        model: str = "gemini-1.5-flash",
        temperature: float = 0.0,
        max_tokens: int = 1024,
        **kwargs
    ) -> dict:
        """
        Generate a JSON completion using the LLM.
        
        Args:
            prompt: The prompt to complete
            model: Model to use for completion
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            **kwargs: Additional model parameters
            
        Returns:
            dict: Generated JSON as a Python dictionary
        """
        import json
        
        response_text = self.complete(
            prompt + "\n\nRespond with valid JSON only.",
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            **kwargs
        )
        
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            # Try to extract JSON from response
            start = response_text.find('{')
            end = response_text.rfind('}') + 1
            if start >= 0 and end > start:
                return json.loads(response_text[start:end])
            raise ValueError("Could not parse JSON from response")


# Global LLM API client instance
_llm_api_client: Optional[LLMAPIClient] = None
_completion_api_client: Optional[CompletionAPIClient] = None


def get_llm_api_client(gemini_api_key: str = "") -> LLMAPIClient:
    """
    Get the global LLM API client instance.
    
    Args:
        gemini_api_key: Google Gemini API key
        
    Returns:
        LLMAPIClient: Global LLM API client
    """
    global _llm_api_client
    if _llm_api_client is None:
        _llm_api_client = LLMAPIClient(gemini_api_key)
    return _llm_api_client


def get_completion_api_client(gemini_api_key: str = "") -> CompletionAPIClient:
    """
    Get the global completion API client instance.
    
    Args:
        gemini_api_key: Google Gemini API key
        
    Returns:
        CompletionAPIClient: Global completion API client
    """
    global _completion_api_client
    if _completion_api_client is None:
        _completion_api_client = CompletionAPIClient(gemini_api_key)
    return _completion_api_client


def get_gemini_key_from_settings() -> str:
    """
    Read Gemini API key from Zenith settings.json file.
    
    The settings file is located at APPDATA/Zenith/settings.json on Windows.
    
    Returns:
        str: Gemini API key, or empty string if not found
    """
    import json
    import platform
    
    try:
        # Determine settings file path based on OS
        if platform.system() == "Windows":
            appdata = os.environ.get("APPDATA", "")
            settings_path = os.path.join(appdata, "Zenith", "settings.json")
        elif platform.system() == "Darwin":  # macOS
            home = os.environ.get("HOME", "")
            settings_path = os.path.join(home, "Library", "Application Support", "Zenith", "settings.json")
        else:  # Linux
            home = os.environ.get("HOME", "")
            settings_path = os.path.join(home, ".config", "Zenith", "settings.json")
        
        if not os.path.exists(settings_path):
            print(f"[gRAG Integration] Settings file not found at: {settings_path}")
            return ""
        
        with open(settings_path, 'r', encoding='utf-8') as f:
            settings = json.load(f)
        
        # Look for Gemini API key in api_keys
        api_keys = settings.get("api_keys", [])
        for api_key_entry in api_keys:
            if api_key_entry.get("provider", "").lower() in ["gemini", "google", "google_ai"]:
                return api_key_entry.get("key", "")
        
        print("[gRAG Integration] No Gemini API key found in settings")
        return ""
        
    except Exception as e:
        print(f"[gRAG Integration] Error reading settings: {e}")
        return ""


def initialize_rag_integration(gemini_api_key: str = "", use_settings: bool = True) -> bool:
    """
    Initialize the RAG integration layer.
    
    Args:
        gemini_api_key: Google Gemini API key (optional)
        use_settings: If True, try to read API key from settings.json first
        
    Returns:
        bool: True if initialization successful
    """
    global _llm_api_client, _completion_api_client
    
    if not _HAS_RAG_ENGINE:
        print("[gRAG Integration] Error: RAG_engine.py not available")
        return False
    
    try:
        # Try to get API key from settings first if requested
        if use_settings and not gemini_api_key:
            gemini_api_key = get_gemini_key_from_settings()
        
        _llm_api_client = LLMAPIClient(gemini_api_key)
        _completion_api_client = CompletionAPIClient(gemini_api_key)
        print("[gRAG Integration] Successfully initialized with RAG_engine.py")
        return True
    except Exception as e:
        print(f"[gRAG Integration] Error initializing: {e}")
        return False
