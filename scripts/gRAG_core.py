"""
gRAG Core Configuration Module
==============================

This module provides core configuration utilities for GraphRAG (Graph Retrieval-Augmented Generation).
Based on Microsoft GraphRAG documentation: https://microsoft.github.io/graphrag/config/overview/

GraphRAG is highly configurable through YAML or JSON settings files. This module helps you:
- Initialize default configurations
- Manage language model settings (completion and embedding models)
- Configure input processing and chunking
- Set up storage and caching
- Configure entity extraction, summarization, and community reporting
- Set up query configurations (local, global, drift, basic search)

Documentation Reference:
- Config Overview: https://microsoft.github.io/graphrag/config/overview/
- Detailed Configuration: https://microsoft.github.io/graphrag/config/yaml/

Author: GraphRAG Python Tools
Version: 1.0.0
"""

import os
import yaml
import json
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field
from pathlib import Path


# ============================================================================
# SECTION 1: Default Configuration Mode
# ============================================================================

class DefaultConfigMode:
    """
    Default Configuration Mode for GraphRAG.
    
    The default configuration mode is the simplest way to get started with GraphRAG.
    It works out-of-the-box with minimal configuration.
    
    Setup Methods:
    1. Init command (recommended first step)
    2. Edit settings.yaml for deeper control
    
    Reference: https://microsoft.github.io/graphrag/config/overview/
    """
    
    @staticmethod
    def create_default_config() -> Dict[str, Any]:
        """
        Create a default GraphRAG configuration dictionary.
        
        Returns:
            Dict[str, Any]: Default configuration with all required sections
        """
        return {
            "completion_models": {},
            "embedding_models": {},
            "input": {},
            "chunking": {},
            "output": {},
            "cache": {},
            "reporting": {},
            "extract_graph": {},
            "summarize_descriptions": {},
            "extract_claims": {},
            "community_reports": {},
            "local_search": {},
            "global_search": {},
            "drift_search": {},
            "basic_search": {}
        }
    
    @staticmethod
    def load_from_yaml(yaml_path: str) -> Dict[str, Any]:
        """
        Load configuration from a YAML file.
        
        Args:
            yaml_path: Path to the settings.yaml file
            
        Returns:
            Dict[str, Any]: Configuration dictionary
            
        Raises:
            FileNotFoundError: If the YAML file doesn't exist
            yaml.YAMLError: If the YAML is malformed
        """
        with open(yaml_path, 'r') as f:
            config = yaml.safe_load(f)
        return config
    
    @staticmethod
    def load_from_json(json_path: str) -> Dict[str, Any]:
        """
        Load configuration from a JSON file.
        
        Args:
            json_path: Path to the settings.json file
            
        Returns:
            Dict[str, Any]: Configuration dictionary
            
        Raises:
            FileNotFoundError: If the JSON file doesn't exist
            json.JSONDecodeError: If the JSON is malformed
        """
        with open(json_path, 'r') as f:
            config = json.load(f)
        return config
    
    @staticmethod
    def save_to_yaml(config: Dict[str, Any], yaml_path: str) -> None:
        """
        Save configuration to a YAML file.
        
        Args:
            config: Configuration dictionary
            yaml_path: Path to save the settings.yaml file
        """
        with open(yaml_path, 'w') as f:
            yaml.dump(config, f, default_flow_style=False)
    
    @staticmethod
    def save_to_json(config: Dict[str, Any], json_path: str) -> None:
        """
        Save configuration to a JSON file.
        
        Args:
            config: Configuration dictionary
            json_path: Path to save the settings.json file
        """
        with open(json_path, 'w') as f:
            json.dump(config, f, indent=2)


# ============================================================================
# SECTION 2: Language Model Setup
# ============================================================================

@dataclass
class ModelConfig:
    """
    Configuration for a language model (completion or embedding).
    
    GraphRAG uses LiteLLM for calling language models, supporting 100+ models.
    The model_provider is the portion prior to '/' while model is the portion following '/'.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#language-model-setup
    """
    
    # Core fields
    type: str = "litellm"  # litellm | mock
    model_provider: str = "openai"  # openai, azure, anthropic, etc.
    model: str = "gpt-4.1"  # Model name
    
    # Authentication
    auth_method: str = "api_key"  # api_key | azure_managed_identity
    api_key: Optional[str] = None
    api_base: Optional[str] = None
    api_version: Optional[str] = None
    azure_deployment_name: Optional[str] = None
    
    # Call arguments
    call_args: Dict[str, Any] = field(default_factory=dict)
    # Example: {"n": 5, "max_completion_tokens": 1000, "temperature": 1.5}
    
    # Retry configuration
    retry: Optional[Dict[str, Any]] = None
    # Example: {"type": "exponential_backoff", "max_retries": 7, "base_delay": 2.0, "jitter": True}
    
    # Rate limiting
    rate_limit: Optional[Dict[str, Any]] = None
    # Example: {"type": "sliding_window", "period_in_seconds": 60, "requests_per_period": 100}
    
    # Metrics
    metrics: Optional[Dict[str, Any]] = None
    # Example: {"type": "default", "store": "memory", "writer": "log", "log_level": 20}


class LanguageModelSetup:
    """
    Language Model Setup for GraphRAG.
    
    Manages completion and embedding model configurations.
    You can specify as many different models as needed and reference them independently.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#language-model-setup
    """
    
    def __init__(self):
        self.completion_models: Dict[str, ModelConfig] = {}
        self.embedding_models: Dict[str, ModelConfig] = {}
    
    def add_completion_model(self, name: str, config: ModelConfig) -> None:
        """
        Add a completion model configuration.
        
        Args:
            name: Reference name for this model (used elsewhere in config)
            config: ModelConfig instance with model settings
        """
        self.completion_models[name] = config
    
    def add_embedding_model(self, name: str, config: ModelConfig) -> None:
        """
        Add an embedding model configuration.
        
        Args:
            name: Reference name for this model (used elsewhere in config)
            config: ModelConfig instance with model settings
        """
        self.embedding_models[name] = config
    
    def get_completion_model(self, name: str) -> Optional[ModelConfig]:
        """Get a completion model configuration by name."""
        return self.completion_models.get(name)
    
    def get_embedding_model(self, name: str) -> Optional[ModelConfig]:
        """Get an embedding model configuration by name."""
        return self.embedding_models.get(name)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary format for YAML/JSON export."""
        return {
            "completion_models": {
                name: self._model_to_dict(config)
                for name, config in self.completion_models.items()
            },
            "embedding_models": {
                name: self._model_to_dict(config)
                for name, config in self.embedding_models.items()
            }
        }
    
    @staticmethod
    def _model_to_dict(config: ModelConfig) -> Dict[str, Any]:
        """Convert ModelConfig to dictionary."""
        return {
            "type": config.type,
            "model_provider": config.model_provider,
            "model": config.model,
            "auth_method": config.auth_method,
            "api_key": config.api_key,
            "api_base": config.api_base,
            "api_version": config.api_version,
            "azure_deployment_name": config.azure_deployment_name,
            "call_args": config.call_args,
            "retry": config.retry,
            "rate_limit": config.rate_limit,
            "metrics": config.metrics,
        }


# ============================================================================
# SECTION 3: Input Files and Chunking
# ============================================================================

@dataclass
class StorageConfig:
    """
    Storage configuration for input/output.
    
    Storage types: file | memory | blob | cosmosdb
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#input-files-and-chunking
    """
    type: str = "file"
    encoding: str = "utf-8"
    base_dir: str = "output"
    
    # Azure-specific
    connection_string: Optional[str] = None
    container_name: Optional[str] = None
    account_url: Optional[str] = None
    database_name: Optional[str] = None


@dataclass
class InputConfig:
    """
    Input configuration for loading source documents.
    
    Supports .csv, .txt, or .json data from input location.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#input
    """
    storage: StorageConfig = field(default_factory=StorageConfig)
    file_type: str = "text"  # text | csv | json
    encoding: str = "utf-8"
    file_pattern: str = ".*\\.txt$"  # Regex to match input files
    
    # CSV/JSON specific
    id_column: Optional[str] = None
    title_column: Optional[str] = None
    text_column: Optional[str] = None


@dataclass
class ChunkingConfig:
    """
    Chunking configuration for parsing documents into text chunks.
    
    Large documents may not fit into a single context window, and graph extraction
    accuracy can be modulated by chunk size and overlap.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#chunking
    """
    type: str = "tokens"  # tokens | sentence
    encoding_model: str = "cl100k_base"  # Text encoding model for token splitting
    size: int = 1200  # Max chunk size in tokens
    overlap: int = 100  # Chunk overlap in tokens
    prepend_metadata: List[str] = field(default_factory=list)  # Metadata fields to prepend


# ============================================================================
# SECTION 4: Outputs and Storage
# ============================================================================

@dataclass
class OutputConfig:
    """
    Output configuration for storing pipeline results.
    
    Controls the storage mechanism for exporting output tables.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#outputs-and-storage
    """
    storage: StorageConfig = field(default_factory=StorageConfig)
    file_type: str = "parquet"  # parquet | csv | json
    encoding: str = "utf-8"


@dataclass
class CacheConfig:
    """
    Cache configuration for LLM invocation results.
    
    Used to cache LLM invocation results for faster performance when re-running.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#cache
    """
    type: str = "json"  # json | memory | none
    storage: StorageConfig = field(default_factory=StorageConfig)


@dataclass
class ReportingConfig:
    """
    Reporting configuration for pipeline events and error messages.
    
    Default is to write reports to a file in the output directory.
    Can also write to Azure Blob Storage.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#reporting
    """
    type: str = "file"  # file | blob
    storage: StorageConfig = field(default_factory=StorageConfig)


# ============================================================================
# SECTION 5: Entity Extraction and Summarization
# ============================================================================

@dataclass
class ExtractGraphConfig:
    """
    Configuration for extracting entities and relationships from text.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#extract_graph
    """
    completion_model_id: str = "default_completion_model"
    model_instance_name: str = "extract_graph"
    prompt: str = "prompts/extract_graph.txt"
    max_gleanings: int = 1  # Maximum number of gleaning cycles
    entity_types: Optional[List[str]] = None  # Entity types to identify


@dataclass
class SummarizeDescriptionsConfig:
    """
    Configuration for summarizing entity/relationship descriptions.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#summarize_descriptions
    """
    completion_model_id: str = "default_completion_model"
    model_instance_name: str = "summarize_descriptions"
    prompt: str = "prompts/summarize_descriptions.txt"
    max_length: int = 500  # Maximum output tokens per summarization
    max_input_length: int = 2000  # Maximum tokens to collect for summarization


@dataclass
class ExtractClaimsConfig:
    """
    Configuration for extracting claims from text.
    
    Disabled by default because claim prompts need user tuning.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#extract_claims
    """
    enabled: bool = False
    completion_model_id: str = "default_completion_model"
    model_instance_name: str = "extract_claims"
    prompt: str = "prompts/extract_claims.txt"
    description: str = "factual claims extracted from text"
    max_gleanings: int = 1


@dataclass
class CommunityReportsConfig:
    """
    Configuration for generating community reports.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#community_reports
    """
    completion_model_id: str = "default_completion_model"
    model_instance_name: str = "community_reporting"
    graph_prompt: Optional[str] = None  # Graph-based summarization prompt
    text_prompt: Optional[str] = None  # Text-based summarization prompt
    max_length: int = 2000  # Maximum output tokens per report
    max_input_length: int = 8000  # Maximum input tokens for reports


# ============================================================================
# SECTION 6: Query Configurations
# ============================================================================

@dataclass
class LocalSearchConfig:
    """
    Configuration for local search queries.
    
    Combines relevant data from knowledge-graph with text chunks.
    Suitable for entity-specific questions.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#local_search
    """
    prompt: str = "prompts/local_search.txt"
    completion_model_id: str = "default_completion_model"
    embedding_model_id: str = "default_embedding_model"
    text_unit_prop: float = 0.5  # Text unit proportion
    community_prop: float = 0.25  # Community proportion
    conversation_history_max_turns: int = 5
    top_k_entities: int = 10  # Top k mapped entities
    top_k_relationships: int = 10  # Top k mapped relationships
    max_context_tokens: int = 8000


@dataclass
class GlobalSearchConfig:
    """
    Configuration for global search queries.
    
    Searches over all AI-generated community reports in map-reduce fashion.
    Resource-intensive but good for dataset-wide questions.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#global_search
    """
    map_prompt: str = "prompts/global_search_map.txt"
    reduce_prompt: str = "prompts/global_search_reduce.txt"
    completion_model_id: str = "default_completion_model"
    knowledge_prompt: str = "prompts/global_search_knowledge.txt"
    data_max_tokens: int = 12000
    map_max_length: int = 1000  # Words
    reduce_max_length: int = 2000  # Words
    dynamic_search_threshold: int = 3  # Rating threshold to include community report
    dynamic_search_keep_parent: bool = True
    dynamic_search_num_repeats: int = 1
    dynamic_search_use_summary: bool = False
    dynamic_search_max_level: int = 2


@dataclass
class DriftSearchConfig:
    """
    Configuration for DRIFT search queries.
    
    Introduces community information into local search process.
    Expands breadth and uses more facts in final answer.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#drift_search
    """
    prompt: str = "prompts/drift_search.txt"
    reduce_prompt: str = "prompts/drift_search_reduce.txt"
    completion_model_id: str = "default_completion_model"
    embedding_model_id: str = "default_embedding_model"
    data_max_tokens: int = 12000
    reduce_max_tokens: int = 2000
    reduce_temperature: float = 0.0
    reduce_max_completion_tokens: int = 2000
    concurrency: int = 4
    drift_k_followups: int = 5  # Number of top global results to retrieve
    primer_folds: int = 3
    primer_llm_max_tokens: int = 2000
    n_depth: int = 3  # Number of drift search steps
    local_search_text_unit_prop: float = 0.5
    local_search_community_prop: float = 0.25
    local_search_top_k_mapped_entities: int = 10
    local_search_top_k_relationships: int = 10
    local_search_max_data_tokens: int = 8000
    local_search_temperature: float = 0.0
    local_search_top_p: float = 1.0
    local_search_n: int = 1
    local_search_llm_max_gen_tokens: int = 2000
    local_search_llm_max_gen_completion_tokens: int = 2000


@dataclass
class BasicSearchConfig:
    """
    Configuration for basic vector RAG search.
    
    Rudimentary implementation for comparing different search results.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#basic_search
    """
    prompt: str = "prompts/basic_search.txt"
    completion_model_id: str = "default_completion_model"
    embedding_model_id: str = "default_embedding_model"
    k: int = 5  # Number of text units to retrieve
    max_context_tokens: int = 8000


# ============================================================================
# SECTION 7: Complete Configuration Builder
# ============================================================================

class GraphRAGConfigBuilder:
    """
    Complete GraphRAG configuration builder.
    
    This class provides a fluent interface to build a complete GraphRAG configuration
    with all sections: models, input, chunking, output, cache, reporting, extraction,
    summarization, and query configurations.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/
    """
    
    def __init__(self):
        self.config = DefaultConfigMode.create_default_config()
        self.model_setup = LanguageModelSetup()
    
    def with_completion_model(self, name: str, config: ModelConfig) -> 'GraphRAGConfigBuilder':
        """Add a completion model configuration."""
        self.model_setup.add_completion_model(name, config)
        return self
    
    def with_embedding_model(self, name: str, config: ModelConfig) -> 'GraphRAGConfigBuilder':
        """Add an embedding model configuration."""
        self.model_setup.add_embedding_model(name, config)
        return self
    
    def with_input_config(self, config: InputConfig) -> 'GraphRAGConfigBuilder':
        """Set input configuration."""
        self.config["input"] = {
            "storage": config.storage.__dict__,
            "type": config.file_type,
            "encoding": config.encoding,
            "file_pattern": config.file_pattern,
            "id_column": config.id_column,
            "title_column": config.title_column,
            "text_column": config.text_column,
        }
        return self
    
    def with_chunking_config(self, config: ChunkingConfig) -> 'GraphRAGConfigBuilder':
        """Set chunking configuration."""
        self.config["chunking"] = config.__dict__
        return self
    
    def with_output_config(self, config: OutputConfig) -> 'GraphRAGConfigBuilder':
        """Set output configuration."""
        self.config["output"] = {
            "storage": config.storage.__dict__,
            "type": config.file_type,
            "encoding": config.encoding,
        }
        return self
    
    def with_cache_config(self, config: CacheConfig) -> 'GraphRAGConfigBuilder':
        """Set cache configuration."""
        self.config["cache"] = {
            "type": config.type,
            "storage": config.storage.__dict__,
        }
        return self
    
    def with_reporting_config(self, config: ReportingConfig) -> 'GraphRAGConfigBuilder':
        """Set reporting configuration."""
        self.config["reporting"] = {
            "type": config.type,
            "storage": config.storage.__dict__,
        }
        return self
    
    def with_extract_graph_config(self, config: ExtractGraphConfig) -> 'GraphRAGConfigBuilder':
        """Set entity extraction configuration."""
        self.config["extract_graph"] = config.__dict__
        return self
    
    def with_summarize_descriptions_config(self, config: SummarizeDescriptionsConfig) -> 'GraphRAGConfigBuilder':
        """Set description summarization configuration."""
        self.config["summarize_descriptions"] = config.__dict__
        return self
    
    def with_extract_claims_config(self, config: ExtractClaimsConfig) -> 'GraphRAGConfigBuilder':
        """Set claim extraction configuration."""
        self.config["extract_claims"] = config.__dict__
        return self
    
    def with_community_reports_config(self, config: CommunityReportsConfig) -> 'GraphRAGConfigBuilder':
        """Set community reports configuration."""
        self.config["community_reports"] = config.__dict__
        return self
    
    def with_local_search_config(self, config: LocalSearchConfig) -> 'GraphRAGConfigBuilder':
        """Set local search configuration."""
        self.config["local_search"] = config.__dict__
        return self
    
    def with_global_search_config(self, config: GlobalSearchConfig) -> 'GraphRAGConfigBuilder':
        """Set global search configuration."""
        self.config["global_search"] = config.__dict__
        return self
    
    def with_drift_search_config(self, config: DriftSearchConfig) -> 'GraphRAGConfigBuilder':
        """Set DRIFT search configuration."""
        self.config["drift_search"] = config.__dict__
        return self
    
    def with_basic_search_config(self, config: BasicSearchConfig) -> 'GraphRAGConfigBuilder':
        """Set basic search configuration."""
        self.config["basic_search"] = config.__dict__
        return self
    
    def build(self) -> Dict[str, Any]:
        """
        Build the complete configuration dictionary.
        
        Returns:
            Dict[str, Any]: Complete configuration ready for YAML/JSON export
        """
        # Add model configurations
        model_dict = self.model_setup.to_dict()
        self.config.update(model_dict)
        
        return self.config
    
    def save_yaml(self, output_path: str) -> None:
        """Save configuration to YAML file."""
        config = self.build()
        DefaultConfigMode.save_to_yaml(config, output_path)
    
    def save_json(self, output_path: str) -> None:
        """Save configuration to JSON file."""
        config = self.build()
        DefaultConfigMode.save_to_json(config, output_path)


# ============================================================================
# SECTION 8: Environment Variable Handling
# ============================================================================

class EnvironmentVariableHandler:
    """
    Handle environment variable substitution in configuration.
    
    GraphRAG supports token replacement using ${ENV_VAR} syntax.
    If a .env file is present with the config file, environment variables
    will be loaded and available for token replacement.
    
    Example:
        # .env
        GRAPHRAG_API_KEY=some_api_key
        
        # settings.yml
        default_chat_model:
          api_key: ${GRAPHRAG_API_KEY}
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#default-configuration-mode-using-yamljson
    """
    
    @staticmethod
    def load_env_file(env_path: str) -> Dict[str, str]:
        """
        Load environment variables from a .env file.
        
        Args:
            env_path: Path to the .env file
            
        Returns:
            Dict[str, str]: Dictionary of environment variables
        """
        env_vars = {}
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    env_vars[key.strip()] = value.strip()
        return env_vars
    
    @staticmethod
    def substitute_env_vars(config: Dict[str, Any], env_vars: Dict[str, str]) -> Dict[str, Any]:
        """
        Substitute environment variables in configuration.
        
        Replaces ${ENV_VAR} patterns with actual values from env_vars.
        
        Args:
            config: Configuration dictionary
            env_vars: Dictionary of environment variables
            
        Returns:
            Dict[str, Any]: Configuration with substituted values
        """
        def substitute(obj):
            if isinstance(obj, str):
                for key, value in env_vars.items():
                    obj = obj.replace(f"${{{key}}}", value)
                return obj
            elif isinstance(obj, dict):
                return {k: substitute(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [substitute(item) for item in obj]
            return obj
        
        return substitute(config)


# ============================================================================
# SECTION 9: Example Usage
# ============================================================================

def example_usage():
    """
    Example usage of gRAG Core Configuration.
    
    This demonstrates how to:
    1. Create a complete GraphRAG configuration
    2. Add language models
    3. Configure input, chunking, and output
    4. Set up extraction and summarization
    5. Configure search methods
    6. Save to YAML/JSON
    """
    
    # Create configuration builder
    builder = GraphRAGConfigBuilder()
    
    # Add completion model
    completion_config = ModelConfig(
        model_provider="openai",
        model="gpt-4.1",
        api_key="${GRAPHRAG_API_KEY}",
        call_args={"temperature": 0.0}
    )
    builder.with_completion_model("default_completion_model", completion_config)
    
    # Add embedding model
    embedding_config = ModelConfig(
        model_provider="openai",
        model="text-embedding-3-large",
        api_key="${GRAPHRAG_API_KEY}"
    )
    builder.with_embedding_model("default_embedding_model", embedding_config)
    
    # Configure input
    input_config = InputConfig(
        file_type="text",
        file_pattern=".*\\.txt$"
    )
    builder.with_input_config(input_config)
    
    # Configure chunking
    chunking_config = ChunkingConfig(
        type="tokens",
        size=1200,
        overlap=100
    )
    builder.with_chunking_config(chunking_config)
    
    # Configure output
    output_config = OutputConfig(
        storage=StorageConfig(base_dir="output"),
        file_type="parquet"
    )
    builder.with_output_config(output_config)
    
    # Configure entity extraction
    extract_config = ExtractGraphConfig(
        completion_model_id="default_completion_model",
        max_gleanings=1
    )
    builder.with_extract_graph_config(extract_config)
    
    # Configure local search
    local_search_config = LocalSearchConfig(
        completion_model_id="default_completion_model",
        embedding_model_id="default_embedding_model",
        top_k_entities=10
    )
    builder.with_local_search_config(local_search_config)
    
    # Build and save configuration
    config = builder.build()
    
    # Save to YAML
    builder.save_yaml("settings.yaml")
    
    # Save to JSON
    builder.save_json("settings.json")
    
    print("Configuration saved to settings.yaml and settings.json")


if __name__ == "__main__":
    example_usage()
