"""
gRAG Index Module
=================

This module provides indexing utilities for GraphRAG (Graph Retrieval-Augmented Generation).
Based on Microsoft GraphRAG documentation: https://microsoft.github.io/graphrag/index/overview/

The GraphRAG indexing pipeline is a data pipeline and transformation suite designed to
extract meaningful, structured data from unstructured text using LLMs.

Indexing Pipelines are configurable. They are composed of:
- Workflows
- Standard and custom steps
- Prompt templates
- Input/output adapters

The standard pipeline is designed to:
- Extract entities, relationships, and claims from raw text
- Perform community detection in entities
- Generate community summaries and reports at multiple levels of granularity
- Embed text into a vector space

Outputs are stored as Parquet tables by default, and embeddings are written to
the configured vector store.

Documentation Reference:
- Index Overview: https://microsoft.github.io/graphrag/index/overview/
- Index Architecture: https://microsoft.github.io/graphrag/index/architecture/

Author: GraphRAG Python Tools
Version: 1.0.0
"""

import os
import asyncio
from typing import Dict, Any, List, Optional, Callable
from dataclasses import dataclass, field
from pathlib import Path
from enum import Enum
import json


# ============================================================================
# SECTION 1: Index Pipeline Overview
# ============================================================================

class IndexPipeline:
    """
    Main GraphRAG Index Pipeline.
    
    The indexing pipeline transforms unstructured text into a structured knowledge graph
    with communities, embeddings, and reports.
    
    Pipeline Stages:
    1. Input Loading: Load documents from configured storage
    2. Chunking: Split documents into text units
    3. Entity Extraction: Extract entities and relationships using LLM
    4. Entity Summarization: Summarize entity descriptions
    5. Community Detection: Detect communities using Leiden algorithm
    6. Community Reporting: Generate community summaries
    7. Embedding: Generate embeddings for text units
    8. Storage: Store outputs as Parquet tables
    
    Reference: https://microsoft.github.io/graphrag/index/overview/
    """
    
    def __init__(self, config: Dict[str, Any]):
        """
        Initialize the index pipeline with configuration.
        
        Args:
            config: GraphRAG configuration dictionary (from gRAG_core.py)
        """
        self.config = config
        self.workflows: List[Workflow] = []
        self.custom_steps: Dict[str, Callable] = {}
    
    def add_workflow(self, workflow: 'Workflow') -> None:
        """
        Add a workflow to the pipeline.
        
        Args:
            workflow: Workflow instance to add
        """
        self.workflows.append(workflow)
    
    def add_custom_step(self, name: str, step: Callable) -> None:
        """
        Add a custom step to the pipeline.
        
        Args:
            name: Name of the custom step
            step: Callable that implements the step logic
        """
        self.custom_steps[name] = step
    
    async def run(self) -> Dict[str, Any]:
        """
        Run the complete indexing pipeline.
        
        Returns:
            Dict[str, Any]: Results including entity counts, community counts, etc.
        """
        results = {
            "status": "running",
            "stages_completed": [],
            "entities_extracted": 0,
            "relationships_extracted": 0,
            "communities_detected": 0,
            "text_units_processed": 0,
            "embeddings_generated": 0,
        }
        
        try:
            # Run each workflow in sequence
            for workflow in self.workflows:
                workflow_results = await workflow.execute(self.config)
                results["stages_completed"].append(workflow.name)
                
                # Aggregate results
                if "entities_extracted" in workflow_results:
                    results["entities_extracted"] += workflow_results["entities_extracted"]
                if "relationships_extracted" in workflow_results:
                    results["relationships_extracted"] += workflow_results["relationships_extracted"]
                if "communities_detected" in workflow_results:
                    results["communities_detected"] += workflow_results["communities_detected"]
                if "text_units_processed" in workflow_results:
                    results["text_units_processed"] += workflow_results["text_units_processed"]
                if "embeddings_generated" in workflow_results:
                    results["embeddings_generated"] += workflow_results["embeddings_generated"]
            
            results["status"] = "completed"
            
        except Exception as e:
            results["status"] = "failed"
            results["error"] = str(e)
            raise
        
        return results


# ============================================================================
# SECTION 2: Workflow System
# ============================================================================

class Workflow:
    """
    Base class for GraphRAG workflows.
    
    Workflows are sequences of steps that process data through the pipeline.
    Standard workflows include entity extraction, community detection, etc.
    
    Reference: https://microsoft.github.io/graphrag/index/architecture/
    """
    
    def __init__(self, name: str):
        """
        Initialize a workflow.
        
        Args:
            name: Name of the workflow
        """
        self.name = name
        self.steps: List['Step'] = []
    
    def add_step(self, step: 'Step') -> None:
        """
        Add a step to this workflow.
        
        Args:
            step: Step instance to add
        """
        self.steps.append(step)
    
    async def execute(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute all steps in this workflow.
        
        Args:
            config: GraphRAG configuration
            
        Returns:
            Dict[str, Any]: Workflow execution results
        """
        results = {"workflow": self.name, "steps_completed": []}
        
        for step in self.steps:
            step_result = await step.execute(config)
            results["steps_completed"].append(step.name)
            results.update(step_result)
        
        return results


class Step:
    """
    Base class for pipeline steps.
    
    Steps are individual processing units within a workflow.
    Each step takes input data, processes it, and produces output data.
    """
    
    def __init__(self, name: str):
        """
        Initialize a step.
        
        Args:
            name: Name of the step
        """
        self.name = name
    
    async def execute(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute this step.
        
        Args:
            config: GraphRAG configuration
            
        Returns:
            Dict[str, Any]: Step execution results
        """
        raise NotImplementedError("Subclasses must implement execute()")


# ============================================================================
# SECTION 3: Input Loading Workflow
# ============================================================================

class InputType(Enum):
    """Input data types supported by GraphRAG."""
    TEXT = "text"
    CSV = "csv"
    JSON = "json"


class InputLoadingStep(Step):
    """
    Step for loading input documents.
    
    Supports .csv, .txt, or .json data from input location.
    Document metadata can be replicated into each chunk.
    
    Reference: https://microsoft.github.io/graphrag/index/inputs/
    """
    
    def __init__(self):
        super().__init__("input_loading")
    
    async def execute(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Load input documents based on configuration.
        
        Args:
            config: GraphRAG configuration with input section
            
        Returns:
            Dict[str, Any]: Loaded documents and metadata
        """
        input_config = config.get("input", {})
        file_type = input_config.get("type", "text")
        file_pattern = input_config.get("file_pattern", ".*\\.txt$")
        encoding = input_config.get("encoding", "utf-8")
        
        # Simulate loading (actual implementation would read from storage)
        documents = self._load_documents(file_type, file_pattern, encoding)
        
        return {
            "documents_loaded": len(documents),
            "text_units_processed": len(documents),
        }
    
    def _load_documents(self, file_type: str, file_pattern: str, encoding: str) -> List[Dict[str, Any]]:
        """
        Load documents from storage.
        
        Args:
            file_type: Type of input files (text, csv, json)
            file_pattern: Regex pattern to match files
            encoding: File encoding
            
        Returns:
            List[Dict[str, Any]]: List of loaded documents
        """
        # Placeholder implementation
        # Actual implementation would use StorageConfig from gRAG_core.py
        return []


# ============================================================================
# SECTION 4: Chunking Workflow
# ============================================================================

class ChunkingType(Enum):
    """Chunking strategies supported by GraphRAG."""
    TOKENS = "tokens"
    SENTENCE = "sentence"


class ChunkingStep(Step):
    """
    Step for chunking documents into text units.
    
    Large documents may not fit into a single context window, and graph extraction
    accuracy can be modulated by chunk size and overlap.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#chunking
    """
    
    def __init__(self):
        super().__init__("chunking")
    
    async def execute(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Chunk documents into text units.
        
        Args:
            config: GraphRAG configuration with chunking section
            
        Returns:
            Dict[str, Any]: Chunking results including text unit count
        """
        chunking_config = config.get("chunking", {})
        chunk_type = chunking_config.get("type", "tokens")
        chunk_size = chunking_config.get("size", 1200)
        chunk_overlap = chunking_config.get("overlap", 100)
        encoding_model = chunking_config.get("encoding_model", "cl100k_base")
        
        # Simulate chunking (actual implementation would use tiktoken or spaCy)
        text_units = self._chunk_documents(chunk_type, chunk_size, chunk_overlap)
        
        return {
            "text_units_created": len(text_units),
            "avg_chunk_size": chunk_size,
        }
    
    def _chunk_documents(self, chunk_type: str, chunk_size: int, chunk_overlap: int) -> List[Dict[str, Any]]:
        """
        Chunk documents into text units.
        
        Args:
            chunk_type: Chunking strategy (tokens or sentence)
            chunk_size: Maximum chunk size
            chunk_overlap: Overlap between chunks
            
        Returns:
            List[Dict[str, Any]]: List of text units
        """
        # Placeholder implementation
        # Actual implementation would use tiktoken for tokens or spaCy for sentences
        return []


# ============================================================================
# SECTION 5: Entity Extraction Workflow
# ============================================================================

class EntityExtractionStep(Step):
    """
    Step for extracting entities and relationships from text.
    
    Uses LLM to extract entities, relationships, and optionally claims from text units.
    Multiple gleaning cycles can be used to improve extraction quality.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#extract_graph
    """
    
    def __init__(self):
        super().__init__("entity_extraction")
    
    async def execute(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract entities and relationships from text units.
        
        Args:
            config: GraphRAG configuration with extract_graph section
            
        Returns:
            Dict[str, Any]: Extraction results including entity and relationship counts
        """
        extract_config = config.get("extract_graph", {})
        completion_model_id = extract_config.get("completion_model_id", "default_completion_model")
        max_gleanings = extract_config.get("max_gleanings", 1)
        prompt = extract_config.get("prompt", "prompts/extract_graph.txt")
        entity_types = extract_config.get("entity_types")
        
        # Simulate extraction (actual implementation would call LLM)
        entities, relationships = self._extract_entities(
            completion_model_id, max_gleanings, prompt, entity_types
        )
        
        return {
            "entities_extracted": len(entities),
            "relationships_extracted": len(relationships),
            "gleaning_cycles": max_gleanings,
        }
    
    def _extract_entities(
        self,
        model_id: str,
        max_gleanings: int,
        prompt: str,
        entity_types: Optional[List[str]]
    ) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Extract entities and relationships using LLM.
        
        Args:
            model_id: Model to use for extraction
            max_gleanings: Number of gleaning cycles
            prompt: Prompt template to use
            entity_types: Specific entity types to extract (optional)
            
        Returns:
            Tuple of (entities, relationships)
        """
        # Placeholder implementation
        # Actual implementation would:
        # 1. Load prompt template
        # 2. Call LLM with text units
        # 3. Run gleaning cycles to refine extraction
        # 4. Return entities and relationships
        return [], []


# ============================================================================
# SECTION 6: Entity Summarization Workflow
# ============================================================================

class SummarizeDescriptionsStep(Step):
    """
    Step for summarizing entity and relationship descriptions.
    
    Consolidates multiple descriptions for entities/relationships into single summaries.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#summarize_descriptions
    """
    
    def __init__(self):
        super().__init__("summarize_descriptions")
    
    async def execute(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Summarize entity and relationship descriptions.
        
        Args:
            config: GraphRAG configuration with summarize_descriptions section
            
        Returns:
            Dict[str, Any]: Summarization results
        """
        summarize_config = config.get("summarize_descriptions", {})
        completion_model_id = summarize_config.get("completion_model_id", "default_completion_model")
        max_length = summarize_config.get("max_length", 500)
        max_input_length = summarize_config.get("max_input_length", 2000)
        
        # Simulate summarization
        summaries = self._summarize_descriptions(completion_model_id, max_length, max_input_length)
        
        return {
            "descriptions_summarized": len(summaries),
        }
    
    def _summarize_descriptions(
        self,
        model_id: str,
        max_length: int,
        max_input_length: int
    ) -> List[Dict[str, Any]]:
        """
        Summarize entity and relationship descriptions.
        
        Args:
            model_id: Model to use for summarization
            max_length: Maximum output tokens per summary
            max_input_length: Maximum input tokens for summarization
            
        Returns:
            List of summarized descriptions
        """
        # Placeholder implementation
        return []


# ============================================================================
# SECTION 7: Community Detection Workflow
# ============================================================================

class CommunityDetectionStep(Step):
    """
    Step for detecting communities in the entity graph.
    
    Uses Leiden hierarchical clustering to create communities from the entity graph.
    Communities are groups of closely related entities.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#cluster_graph
    """
    
    def __init__(self):
        super().__init__("community_detection")
    
    async def execute(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Detect communities in the entity graph.
        
        Args:
            config: GraphRAG configuration with cluster_graph section
            
        Returns:
            Dict[str, Any]: Community detection results
        """
        cluster_config = config.get("cluster_graph", {})
        max_cluster_size = cluster_config.get("max_cluster_size", 100)
        use_lcc = cluster_config.get("use_lcc", True)
        seed = cluster_config.get("seed", 42)
        
        # Simulate community detection
        communities = self._detect_communities(max_cluster_size, use_lcc, seed)
        
        return {
            "communities_detected": len(communities),
            "max_cluster_size": max_cluster_size,
        }
    
    def _detect_communities(
        self,
        max_cluster_size: int,
        use_lcc: bool,
        seed: int
    ) -> List[Dict[str, Any]]:
        """
        Detect communities using Leiden algorithm.
        
        Args:
            max_cluster_size: Maximum cluster size to export
            use_lcc: Whether to use only largest connected component
            seed: Randomization seed for consistency
            
        Returns:
            List of detected communities
        """
        # Placeholder implementation
        # Actual implementation would use python-louvain or similar
        return []


# ============================================================================
# SECTION 8: Community Reporting Workflow
# ============================================================================

class CommunityReportingStep(Step):
    """
    Step for generating community reports.
    
    Generates summaries and reports for each community at multiple levels of granularity.
    Can use graph-based or text-based summarization.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#community_reports
    """
    
    def __init__(self):
        super().__init__("community_reporting")
    
    async def execute(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate community reports.
        
        Args:
            config: GraphRAG configuration with community_reports section
            
        Returns:
            Dict[str, Any]: Community reporting results
        """
        report_config = config.get("community_reports", {})
        completion_model_id = report_config.get("completion_model_id", "default_completion_model")
        max_length = report_config.get("max_length", 2000)
        max_input_length = report_config.get("max_input_length", 8000)
        
        # Simulate report generation
        reports = self._generate_reports(completion_model_id, max_length, max_input_length)
        
        return {
            "reports_generated": len(reports),
        }
    
    def _generate_reports(
        self,
        model_id: str,
        max_length: int,
        max_input_length: int
    ) -> List[Dict[str, Any]]:
        """
        Generate community reports.
        
        Args:
            model_id: Model to use for report generation
            max_length: Maximum output tokens per report
            max_input_length: Maximum input tokens for reports
            
        Returns:
            List of generated community reports
        """
        # Placeholder implementation
        return []


# ============================================================================
# SECTION 9: Embedding Workflow
# ============================================================================

class EmbeddingStep(Step):
    """
    Step for generating embeddings for text units.
    
    Embeds text into a vector space for similarity search.
    Embeddings are written to the configured vector store.
    
    Reference: https://microsoft.github.io/graphrag/index/overview/
    """
    
    def __init__(self):
        super().__init__("embedding")
    
    async def execute(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate embeddings for text units.
        
        Args:
            config: GraphRAG configuration with embedding model
            
        Returns:
            Dict[str, Any]: Embedding results
        """
        embedding_model_id = config.get("embedding_models", {}).get("default_embedding_model", {})
        model_name = embedding_model_id.get("model", "text-embedding-3-large")
        
        # Simulate embedding generation
        embeddings = self._generate_embeddings(model_name)
        
        return {
            "embeddings_generated": len(embeddings),
        }
    
    def _generate_embeddings(self, model_name: str) -> List[List[float]]:
        """
        Generate embeddings for text units.
        
        Args:
            model_name: Name of the embedding model to use
            
        Returns:
            List of embedding vectors
        """
        # Placeholder implementation
        # Actual implementation would use the configured embedding model
        return []


# ============================================================================
# SECTION 10: Storage Workflow
# ============================================================================

class StorageStep(Step):
    """
    Step for storing pipeline outputs.
    
    Stores outputs as Parquet tables by default.
    Can also write to memory, blob storage, or CosmosDB.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#outputs-and-storage
    """
    
    def __init__(self):
        super().__init__("storage")
    
    async def execute(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Store pipeline outputs.
        
        Args:
            config: GraphRAG configuration with output section
            
        Returns:
            Dict[str, Any]: Storage results
        """
        output_config = config.get("output", {})
        storage_type = output_config.get("storage", {}).get("type", "file")
        base_dir = output_config.get("storage", {}).get("base_dir", "output")
        file_type = output_config.get("type", "parquet")
        
        # Simulate storage
        self._store_outputs(storage_type, base_dir, file_type)
        
        return {
            "storage_type": storage_type,
            "base_dir": base_dir,
            "file_type": file_type,
        }
    
    def _store_outputs(self, storage_type: str, base_dir: str, file_type: str) -> None:
        """
        Store pipeline outputs to configured storage.
        
        Args:
            storage_type: Type of storage (file, memory, blob, cosmosdb)
            base_dir: Base directory for file storage
            file_type: File format (parquet, csv, json)
        """
        # Placeholder implementation
        # Actual implementation would write to configured storage


# ============================================================================
# SECTION 11: Standard Pipeline Builder
# ============================================================================

class StandardPipelineBuilder:
    """
    Builder for the standard GraphRAG indexing pipeline.
    
    Creates a pre-configured pipeline with all standard workflows:
    1. Input Loading
    2. Chunking
    3. Entity Extraction
    4. Entity Summarization
    5. Community Detection
    6. Community Reporting
    7. Embedding
    8. Storage
    
    Reference: https://microsoft.github.io/graphrag/index/overview/
    """
    
    @staticmethod
    def build(config: Dict[str, Any]) -> IndexPipeline:
        """
        Build the standard indexing pipeline.
        
        Args:
            config: GraphRAG configuration dictionary
            
        Returns:
            IndexPipeline: Configured pipeline ready to run
        """
        pipeline = IndexPipeline(config)
        
        # Create entity extraction workflow
        extraction_workflow = Workflow("entity_extraction")
        extraction_workflow.add_step(InputLoadingStep())
        extraction_workflow.add_step(ChunkingStep())
        extraction_workflow.add_step(EntityExtractionStep())
        extraction_workflow.add_step(SummarizeDescriptionsStep())
        pipeline.add_workflow(extraction_workflow)
        
        # Create community detection workflow
        community_workflow = Workflow("community_detection")
        community_workflow.add_step(CommunityDetectionStep())
        community_workflow.add_step(CommunityReportingStep())
        pipeline.add_workflow(community_workflow)
        
        # Create embedding workflow
        embedding_workflow = Workflow("embedding")
        embedding_workflow.add_step(EmbeddingStep())
        pipeline.add_workflow(embedding_workflow)
        
        # Create storage workflow
        storage_workflow = Workflow("storage")
        storage_workflow.add_step(StorageStep())
        pipeline.add_workflow(storage_workflow)
        
        return pipeline


# ============================================================================
# SECTION 12: CLI Interface
# ============================================================================

class IndexCLI:
    """
    Command-line interface for GraphRAG indexing.
    
    Provides CLI-style access to the indexing pipeline.
    
    Reference: https://microsoft.github.io/graphrag/index/overview/#cli
    """
    
    @staticmethod
    def index(root: str = ".", config: str = "settings.yaml") -> Dict[str, Any]:
        """
        Run the indexing pipeline from command line.
        
        Args:
            root: Root directory of the project (default: current directory)
            config: Path to configuration file (default: settings.yaml)
            
        Returns:
            Dict[str, Any]: Indexing results
        """
        # Load configuration
        from gRAG_core import DefaultConfigMode
        
        config_path = os.path.join(root, config)
        if config.endswith(".yaml") or config.endswith(".yml"):
            config_dict = DefaultConfigMode.load_from_yaml(config_path)
        elif config.endswith(".json"):
            config_dict = DefaultConfigMode.load_from_json(config_path)
        else:
            raise ValueError("Config file must be .yaml, .yml, or .json")
        
        # Build pipeline
        pipeline = StandardPipelineBuilder.build(config_dict)
        
        # Run pipeline
        return asyncio.run(pipeline.run())


# ============================================================================
# SECTION 13: Python API Interface
# ============================================================================

class IndexAPI:
    """
    Python API interface for GraphRAG indexing.
    
    Provides programmatic access to the indexing pipeline.
    
    Reference: https://microsoft.github.io/graphrag/index/overview/#python-api
    """
    
    def __init__(self, config: Dict[str, Any]):
        """
        Initialize the index API.
        
        Args:
            config: GraphRAG configuration dictionary
        """
        self.config = config
        self.pipeline: Optional[IndexPipeline] = None
    
    def build_pipeline(self) -> IndexPipeline:
        """
        Build the indexing pipeline.
        
        Returns:
            IndexPipeline: Configured pipeline
        """
        self.pipeline = StandardPipelineBuilder.build(self.config)
        return self.pipeline
    
    async def run_index(self) -> Dict[str, Any]:
        """
        Run the indexing pipeline.
        
        Returns:
            Dict[str, Any]: Indexing results
        """
        if self.pipeline is None:
            self.build_pipeline()
        return await self.pipeline.run()
    
    def run_index_sync(self) -> Dict[str, Any]:
        """
        Run the indexing pipeline synchronously.
        
        Returns:
            Dict[str, Any]: Indexing results
        """
        return asyncio.run(self.run_index())


# ============================================================================
# SECTION 14: Incremental Indexing
# ============================================================================

class IncrementalIndexer:
    """
    Incremental indexing for updating existing indexes.
    
    Allows adding new documents to an existing index without reprocessing
    the entire dataset.
    
    Reference: https://microsoft.github.io/graphrag/config/yaml/#update_output_storage
    """
    
    def __init__(self, config: Dict[str, Any], existing_index_path: str):
        """
        Initialize incremental indexer.
        
        Args:
            config: GraphRAG configuration
            existing_index_path: Path to existing index
        """
        self.config = config
        self.existing_index_path = existing_index_path
    
    async def add_documents(self, new_documents: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Add new documents to existing index.
        
        Args:
            new_documents: List of new documents to add
            
        Returns:
            Dict[str, Any]: Incremental indexing results
        """
        # Load existing index
        existing_entities = self._load_existing_entities()
        
        # Process new documents
        pipeline = StandardPipelineBuilder.build(self.config)
        results = await pipeline.run()
        
        # Merge with existing index
        merged_entities = self._merge_entities(existing_entities, results.get("entities_extracted", 0))
        
        return {
            "new_documents_processed": len(new_documents),
            "existing_entities": len(existing_entities),
            "total_entities": merged_entities,
        }
    
    def _load_existing_entities(self) -> int:
        """Load existing entities from index."""
        # Placeholder implementation
        return 0
    
    def _merge_entities(self, existing: int, new: int) -> int:
        """Merge existing and new entities."""
        return existing + new


# ============================================================================
# SECTION 15: Example Usage
# ============================================================================

async def example_usage():
    """
    Example usage of gRAG Index.
    
    This demonstrates how to:
    1. Load configuration
    2. Build the standard pipeline
    3. Run the indexing pipeline
    4. Use the Python API
    5. Perform incremental indexing
    """
    
    # Load configuration
    from gRAG_core import DefaultConfigMode, GraphRAGConfigBuilder, ModelConfig
    
    # Option 1: Load from file
    config = DefaultConfigMode.load_from_yaml("settings.yaml")
    
    # Option 2: Build programmatically
    builder = GraphRAGConfigBuilder()
    builder.with_completion_model(
        "default_completion_model",
        ModelConfig(model="gpt-4.1", api_key="${GRAPHRAG_API_KEY}")
    )
    builder.with_embedding_model(
        "default_embedding_model",
        ModelConfig(model="text-embedding-3-large", api_key="${GRAPHRAG_API_KEY}")
    )
    config = builder.build()
    
    # Build and run pipeline
    pipeline = StandardPipelineBuilder.build(config)
    results = await pipeline.run()
    
    print(f"Indexing completed: {results['status']}")
    print(f"Entities extracted: {results['entities_extracted']}")
    print(f"Relationships extracted: {results['relationships_extracted']}")
    print(f"Communities detected: {results['communities_detected']}")
    
    # Or use the Python API
    api = IndexAPI(config)
    api_results = api.run_index_sync()
    
    print(f"API Indexing completed: {api_results['status']}")


if __name__ == "__main__":
    asyncio.run(example_usage())
