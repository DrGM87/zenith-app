"""
gRAG Query Module
=================

This module provides query utilities for GraphRAG (Graph Retrieval-Augmented Generation).
Based on Microsoft GraphRAG documentation: https://microsoft.github.io/graphrag/query/overview/

The Query Engine is the retrieval module of the GraphRAG library. It operates over
completed indexes and provides several search methods:

- Local Search: Combines knowledge-graph with text chunks for entity-specific questions
- Global Search: Searches over community reports in map-reduce fashion for dataset-wide questions
- DRIFT Search: Community-enhanced local search with broader context
- Basic Search: Rudimentary vector RAG for comparison
- Question Generation: Generates follow-up questions from queries

Documentation Reference:
- Query Overview: https://microsoft.github.io/graphrag/query/overview/
- Local Search: https://microsoft.github.io/graphrag/query/local_search/
- Global Search: https://microsoft.github.io/graphrag/query/global_search/
- DRIFT Search: https://microsoft.github.io/graphrag/query/drift_search/
- Question Generation: https://microsoft.github.io/graphrag/query/question_generation/

Author: GraphRAG Python Tools
Version: 1.0.0
"""

import os
import asyncio
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum
import json


# ============================================================================
# SECTION 1: Query Engine Overview
# ============================================================================

class QueryEngine:
    """
    Main GraphRAG Query Engine.
    
    The Query Engine operates over completed indexes and provides multiple search methods
    for retrieving relevant information from the knowledge graph and text units.
    
    Search Methods:
    1. Local Search: Entity-specific questions using knowledge-graph + text chunks
    2. Global Search: Dataset-wide questions using community reports (map-reduce)
    3. DRIFT Search: Community-enhanced local search with broader context
    4. Basic Search: Vector RAG for comparison
    
    Reference: https://microsoft.github.io/graphrag/query/overview/
    """
    
    def __init__(self, config: Dict[str, Any], index_path: str):
        """
        Initialize the query engine.
        
        Args:
            config: GraphRAG configuration dictionary (from gRAG_core.py)
            index_path: Path to the completed index directory
        """
        self.config = config
        self.index_path = index_path
        self.loaded_index: Optional[Dict[str, Any]] = None
    
    def load_index(self) -> None:
        """
        Load the completed index from disk.
        
        Loads the Parquet tables containing entities, relationships, communities,
        text units, and embeddings.
        """
        # Placeholder implementation
        # Actual implementation would load Parquet files from index_path
        self.loaded_index = {
            "entities": [],
            "relationships": [],
            "communities": [],
            "text_units": [],
            "community_reports": [],
            "embeddings": [],
        }
    
    def local_search(self, query: str, **kwargs) -> Dict[str, Any]:
        """
        Perform a local search query.
        
        Local search generates answers by combining relevant data from the AI-extracted
        knowledge-graph with text chunks of the raw documents. This method is suitable
        for questions that require an understanding of specific entities mentioned in
        the documents.
        
        Args:
            query: The search query
            **kwargs: Additional search parameters
            
        Returns:
            Dict[str, Any]: Search results including answer and context
        """
        if self.loaded_index is None:
            self.load_index()
        
        search_config = self.config.get("local_search", {})
        local_search = LocalSearch(search_config, self.loaded_index)
        return local_search.search(query, **kwargs)
    
    def global_search(self, query: str, **kwargs) -> Dict[str, Any]:
        """
        Perform a global search query.
        
        Global search generates answers by searching over all AI-generated community
        reports in a map-reduce fashion. This is a resource-intensive method, but often
        gives good responses for questions that require an understanding of the dataset
        as a whole.
        
        Args:
            query: The search query
            **kwargs: Additional search parameters
            
        Returns:
            Dict[str, Any]: Search results including answer and context
        """
        if self.loaded_index is None:
            self.load_index()
        
        search_config = self.config.get("global_search", {})
        global_search = GlobalSearch(search_config, self.loaded_index)
        return global_search.search(query, **kwargs)
    
    def drift_search(self, query: str, **kwargs) -> Dict[str, Any]:
        """
        Perform a DRIFT search query.
        
        DRIFT Search introduces a new approach to local search queries by including
        community information in the search process. This greatly expands the breadth
        of the query's starting point and leads to retrieval and usage of a far higher
        variety of facts in the final answer.
        
        Args:
            query: The search query
            **kwargs: Additional search parameters
            
        Returns:
            Dict[str, Any]: Search results including answer and context
        """
        if self.loaded_index is None:
            self.load_index()
        
        search_config = self.config.get("drift_search", {})
        drift_search = DriftSearch(search_config, self.loaded_index)
        return drift_search.search(query, **kwargs)
    
    def basic_search(self, query: str, **kwargs) -> Dict[str, Any]:
        """
        Perform a basic vector RAG search.
        
        GraphRAG includes a rudimentary implementation of basic vector RAG to make
        it easy to compare different search results based on the type of question you
        are asking.
        
        Args:
            query: The search query
            **kwargs: Additional search parameters
            
        Returns:
            Dict[str, Any]: Search results including answer and context
        """
        if self.loaded_index is None:
            self.load_index()
        
        search_config = self.config.get("basic_search", {})
        basic_search = BasicSearch(search_config, self.loaded_index)
        return basic_search.search(query, **kwargs)
    
    def generate_questions(self, queries: List[str], **kwargs) -> List[str]:
        """
        Generate follow-up questions from a list of queries.
        
        This functionality takes a list of user queries and generates the next candidate
        questions. This is useful for generating follow-up questions in a conversation
        or for generating a list of questions for the investigator to dive deeper into
        the dataset.
        
        Args:
            queries: List of user queries
            **kwargs: Additional generation parameters
            
        Returns:
            List[str]: Generated follow-up questions
        """
        if self.loaded_index is None:
            self.load_index()
        
        question_generator = QuestionGenerator(self.loaded_index)
        return question_generator.generate(queries, **kwargs)


# ============================================================================
# SECTION 2: Local Search
# ============================================================================

@dataclass
class LocalSearchConfig:
    """
    Configuration for local search.
    
    Local search combines relevant data from the AI-extracted knowledge-graph with
    text chunks of the raw documents. Suitable for entity-specific questions.
    
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


class LocalSearch:
    """
    Local Search implementation.
    
    Local search generates answers by combining relevant data from the AI-extracted
    knowledge-graph with text chunks of the raw documents. This method is suitable
    for questions that require an understanding of specific entities mentioned in
    the documents (e.g., "What are the healing properties of chamomile?").
    
    Reference: https://microsoft.github.io/graphrag/query/local_search/
    """
    
    def __init__(self, config: Dict[str, Any], index: Dict[str, Any]):
        """
        Initialize local search.
        
        Args:
            config: Local search configuration
            index: Loaded index data
        """
        self.config = LocalSearchConfig(**config)
        self.index = index
    
    def search(self, query: str, **kwargs) -> Dict[str, Any]:
        """
        Perform a local search.
        
        Args:
            query: The search query
            **kwargs: Override configuration parameters
            
        Returns:
            Dict[str, Any]: Search results
        """
        # Override config with kwargs
        for key, value in kwargs.items():
            if hasattr(self.config, key):
                setattr(self.config, key, value)
        
        # Step 1: Embed the query
        query_embedding = self._embed_query(query)
        
        # Step 2: Find relevant entities using embedding similarity
        relevant_entities = self._find_relevant_entities(query_embedding)
        
        # Step 3: Get relationships for relevant entities
        relevant_relationships = self._get_relationships(relevant_entities)
        
        # Step 4: Get communities for relevant entities
        relevant_communities = self._get_communities(relevant_entities)
        
        # Step 5: Get text units for context
        relevant_text_units = self._get_text_units(relevant_entities)
        
        # Step 6: Build context
        context = self._build_context(
            query,
            relevant_entities,
            relevant_relationships,
            relevant_communities,
            relevant_text_units
        )
        
        # Step 7: Generate answer using LLM
        answer = self._generate_answer(query, context)
        
        return {
            "query": query,
            "answer": answer,
            "context": context,
            "entities_used": len(relevant_entities),
            "relationships_used": len(relevant_relationships),
            "communities_used": len(relevant_communities),
            "text_units_used": len(relevant_text_units),
        }
    
    def _embed_query(self, query: str) -> List[float]:
        """Embed the query using the configured embedding model."""
        # Placeholder implementation
        # Actual implementation would use the embedding model
        return []
    
    def _find_relevant_entities(self, query_embedding: List[float]) -> List[Dict[str, Any]]:
        """Find relevant entities using embedding similarity."""
        # Placeholder implementation
        # Actual implementation would:
        # 1. Compute similarity between query embedding and entity embeddings
        # 2. Return top_k entities
        return []
    
    def _get_relationships(self, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Get relationships for the relevant entities."""
        # Placeholder implementation
        # Actual implementation would:
        # 1. Find relationships involving the entities
        # 2. Return top_k relationships
        return []
    
    def _get_communities(self, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Get communities for the relevant entities."""
        # Placeholder implementation
        # Actual implementation would:
        # 1. Find communities containing the entities
        # 2. Return community reports
        return []
    
    def _get_text_units(self, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Get text units for context."""
        # Placeholder implementation
        # Actual implementation would:
        # 1. Find text units containing the entities
        # 2. Return text units based on text_unit_prop
        return []
    
    def _build_context(
        self,
        query: str,
        entities: List[Dict[str, Any]],
        relationships: List[Dict[str, Any]],
        communities: List[Dict[str, Any]],
        text_units: List[Dict[str, Any]]
    ) -> str:
        """Build the context string for the LLM."""
        # Placeholder implementation
        # Actual implementation would combine entities, relationships, communities, and text units
        return ""
    
    def _generate_answer(self, query: str, context: str) -> str:
        """Generate answer using the LLM."""
        # Placeholder implementation
        # Actual implementation would:
        # 1. Load prompt template
        # 2. Call LLM with query and context
        # 3. Return the answer
        return ""


# ============================================================================
# SECTION 3: Global Search
# ============================================================================

@dataclass
class GlobalSearchConfig:
    """
    Configuration for global search.
    
    Global search searches over all AI-generated community reports in map-reduce fashion.
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


class GlobalSearch:
    """
    Global Search implementation.
    
    Global search generates answers by searching over all AI-generated community
    reports in a map-reduce fashion. This is a resource-intensive method, but often
    gives good responses for questions that require an understanding of the dataset
    as a whole (e.g., "What are the most significant values of the herbs mentioned
    in this notebook?").
    
    Reference: https://microsoft.github.io/graphrag/query/global_search/
    """
    
    def __init__(self, config: Dict[str, Any], index: Dict[str, Any]):
        """
        Initialize global search.
        
        Args:
            config: Global search configuration
            index: Loaded index data
        """
        self.config = GlobalSearchConfig(**config)
        self.index = index
    
    def search(self, query: str, **kwargs) -> Dict[str, Any]:
        """
        Perform a global search.
        
        Args:
            query: The search query
            **kwargs: Override configuration parameters
            
        Returns:
            Dict[str, Any]: Search results
        """
        # Override config with kwargs
        for key, value in kwargs.items():
            if hasattr(self.config, key):
                setattr(self.config, key, value)
        
        # Step 1: Get all community reports
        community_reports = self.index.get("community_reports", [])
        
        # Step 2: Dynamic search - rate community reports by relevance
        relevant_reports = self._dynamic_search(query, community_reports)
        
        # Step 3: Map phase - generate intermediate responses for each relevant report
        map_responses = self._map_phase(query, relevant_reports)
        
        # Step 4: Reduce phase - combine map responses into final answer
        final_answer = self._reduce_phase(query, map_responses)
        
        return {
            "query": query,
            "answer": final_answer,
            "reports_used": len(relevant_reports),
            "map_responses": len(map_responses),
        }
    
    def _dynamic_search(self, query: str, reports: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Dynamically search for relevant community reports.
        
        Rates community reports by relevance and filters based on threshold.
        
        Args:
            query: The search query
            reports: All community reports
            
        Returns:
            List of relevant community reports
        """
        # Placeholder implementation
        # Actual implementation would:
        # 1. Rate each community report by relevance to query
        # 2. Filter reports above threshold
        # 3. Optionally keep parent communities
        return []
    
    def _map_phase(self, query: str, reports: List[Dict[str, Any]]) -> List[str]:
        """
        Map phase - generate intermediate responses.
        
        Generates intermediate responses for each relevant community report.
        
        Args:
            query: The search query
            reports: Relevant community reports
            
        Returns:
            List of intermediate responses
        """
        # Placeholder implementation
        # Actual implementation would:
        # 1. Load map prompt template
        # 2. Call LLM for each report with query
        # 3. Collect intermediate responses
        return []
    
    def _reduce_phase(self, query: str, map_responses: List[str]) -> str:
        """
        Reduce phase - combine map responses.
        
        Combines intermediate responses into a final answer.
        
        Args:
            query: The search query
            map_responses: Intermediate responses from map phase
            
        Returns:
            Final answer
        """
        # Placeholder implementation
        # Actual implementation would:
        # 1. Load reduce prompt template
        # 2. Call LLM with all map responses
        # 3. Return final answer
        return ""


# ============================================================================
# SECTION 4: DRIFT Search
# ============================================================================

@dataclass
class DriftSearchConfig:
    """
    Configuration for DRIFT search.
    
    DRIFT Search introduces community information into local search process,
    expanding breadth and using more facts in final answer.
    
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


class DriftSearch:
    """
    DRIFT Search implementation.
    
    DRIFT Search introduces a new approach to local search queries by including
    community information in the search process. This greatly expands the breadth
    of the query's starting point and leads to retrieval and usage of a far higher
    variety of facts in the final answer. This expands the GraphRAG query engine
    by providing a more comprehensive option for local search, which uses community
    insights to refine a query into detailed follow-up questions.
    
    Reference: https://microsoft.github.io/graphrag/query/drift_search/
    """
    
    def __init__(self, config: Dict[str, Any], index: Dict[str, Any]):
        """
        Initialize DRIFT search.
        
        Args:
            config: DRIFT search configuration
            index: Loaded index data
        """
        self.config = DriftSearchConfig(**config)
        self.index = index
    
    def search(self, query: str, **kwargs) -> Dict[str, Any]:
        """
        Perform a DRIFT search.
        
        Args:
            query: The search query
            **kwargs: Override configuration parameters
            
        Returns:
            Dict[str, Any]: Search results
        """
        # Override config with kwargs
        for key, value in kwargs.items():
            if hasattr(self.config, key):
                setattr(self.config, key, value)
        
        # Step 1: Primer phase - generate initial search terms using community insights
        primer_results = self._primer_phase(query)
        
        # Step 2: Drift phase - iteratively refine search
        drift_results = self._drift_phase(query, primer_results)
        
        # Step 3: Reduce phase - combine results into final answer
        final_answer = self._reduce_phase(query, drift_results)
        
        return {
            "query": query,
            "answer": final_answer,
            "primer_results": primer_results,
            "drift_steps": len(drift_results),
        }
    
    def _primer_phase(self, query: str) -> Dict[str, Any]:
        """
        Primer phase - generate initial search terms.
        
        Uses community insights to refine the query into detailed follow-up questions.
        
        Args:
            query: The original query
            
        Returns:
            Primer results with refined queries
        """
        # Placeholder implementation
        # Actual implementation would:
        # 1. Get community reports
        # 2. Use LLM to generate refined queries
        # 3. Return primer results
        return {}
    
    def _drift_phase(self, query: str, primer_results: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Drift phase - iteratively refine search.
        
        Performs multiple search steps to gather comprehensive information.
        
        Args:
            query: The original query
            primer_results: Results from primer phase
            
        Returns:
            List of results from each drift step
        """
        # Placeholder implementation
        # Actual implementation would:
        # 1. Perform n_depth search steps
        # 2. Each step uses local search with community information
        # 3. Collect results from each step
        return []
    
    def _reduce_phase(self, query: str, drift_results: List[Dict[str, Any]]) -> str:
        """
        Reduce phase - combine drift results.
        
        Combines results from all drift steps into a final answer.
        
        Args:
            query: The original query
            drift_results: Results from drift phase
            
        Returns:
            Final answer
        """
        # Placeholder implementation
        # Actual implementation would:
        # 1. Load reduce prompt template
        # 2. Call LLM with all drift results
        # 3. Return final answer
        return ""


# ============================================================================
# SECTION 5: Basic Search
# ============================================================================

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


class BasicSearch:
    """
    Basic Search implementation.
    
    GraphRAG includes a rudimentary implementation of basic vector RAG to make
    it easy to compare different search results based on the type of question you
    are asking. You can specify the top k text unit chunks to include in the
    summarization context.
    
    Reference: https://microsoft.github.io/graphrag/query/overview/#basic-search
    """
    
    def __init__(self, config: Dict[str, Any], index: Dict[str, Any]):
        """
        Initialize basic search.
        
        Args:
            config: Basic search configuration
            index: Loaded index data
        """
        self.config = BasicSearchConfig(**config)
        self.index = index
    
    def search(self, query: str, **kwargs) -> Dict[str, Any]:
        """
        Perform a basic vector RAG search.
        
        Args:
            query: The search query
            **kwargs: Override configuration parameters
            
        Returns:
            Dict[str, Any]: Search results
        """
        # Override config with kwargs
        for key, value in kwargs.items():
            if hasattr(self.config, key):
                setattr(self.config, key, value)
        
        # Step 1: Embed the query
        query_embedding = self._embed_query(query)
        
        # Step 2: Find top k similar text units
        similar_text_units = self._find_similar_text_units(query_embedding)
        
        # Step 3: Build context from text units
        context = self._build_context(similar_text_units)
        
        # Step 4: Generate answer
        answer = self._generate_answer(query, context)
        
        return {
            "query": query,
            "answer": answer,
            "context": context,
            "text_units_used": len(similar_text_units),
        }
    
    def _embed_query(self, query: str) -> List[float]:
        """Embed the query using the configured embedding model."""
        # Placeholder implementation
        return []
    
    def _find_similar_text_units(self, query_embedding: List[float]) -> List[Dict[str, Any]]:
        """Find top k similar text units using embedding similarity."""
        # Placeholder implementation
        return []
    
    def _build_context(self, text_units: List[Dict[str, Any]]) -> str:
        """Build context from text units."""
        # Placeholder implementation
        return ""
    
    def _generate_answer(self, query: str, context: str) -> str:
        """Generate answer using the LLM."""
        # Placeholder implementation
        return ""


# ============================================================================
# SECTION 6: Question Generation
# ============================================================================

class QuestionGenerator:
    """
    Question Generation implementation.
    
    This functionality takes a list of user queries and generates the next candidate
    questions. This is useful for generating follow-up questions in a conversation or
    for generating a list of questions for the investigator to dive deeper into the
    dataset.
    
    Reference: https://microsoft.github.io/graphrag/query/question_generation/
    """
    
    def __init__(self, index: Dict[str, Any]):
        """
        Initialize question generator.
        
        Args:
            index: Loaded index data
        """
        self.index = index
    
    def generate(self, queries: List[str], **kwargs) -> List[str]:
        """
        Generate follow-up questions from queries.
        
        Args:
            queries: List of user queries
            **kwargs: Additional generation parameters
            
        Returns:
            List of generated follow-up questions
        """
        # Placeholder implementation
        # Actual implementation would:
        # 1. Load question generation prompt
        # 2. Call LLM with queries and context
        # 3. Return generated questions
        return []


# ============================================================================
# SECTION 7: Search Method Comparison
# ============================================================================

class SearchComparator:
    """
    Compare results from different search methods.
    
    Useful for evaluating which search method works best for a given query type.
    """
    
    def __init__(self, query_engine: QueryEngine):
        """
        Initialize search comparator.
        
        Args:
            query_engine: Configured query engine
        """
        self.query_engine = query_engine
    
    def compare_all(self, query: str) -> Dict[str, Any]:
        """
        Run all search methods and compare results.
        
        Args:
            query: The search query
            
        Returns:
            Dict with results from each search method
        """
        return {
            "local": self.query_engine.local_search(query),
            "global": self.query_engine.global_search(query),
            "drift": self.query_engine.drift_search(query),
            "basic": self.query_engine.basic_search(query),
        }
    
    def compare_methods(self, query: str, methods: List[str]) -> Dict[str, Any]:
        """
        Compare specific search methods.
        
        Args:
            query: The search query
            methods: List of method names to compare (local, global, drift, basic)
            
        Returns:
            Dict with results from specified methods
        """
        results = {}
        for method in methods:
            if method == "local":
                results[method] = self.query_engine.local_search(query)
            elif method == "global":
                results[method] = self.query_engine.global_search(query)
            elif method == "drift":
                results[method] = self.query_engine.drift_search(query)
            elif method == "basic":
                results[method] = self.query_engine.basic_search(query)
        return results


# ============================================================================
# SECTION 8: Conversation History
# ============================================================================

class ConversationManager:
    """
    Manage conversation history for multi-turn queries.
    
    Maintains conversation context for queries that reference previous turns.
    """
    
    def __init__(self, max_turns: int = 5):
        """
        Initialize conversation manager.
        
        Args:
            max_turns: Maximum number of conversation turns to keep
        """
        self.max_turns = max_turns
        self.history: List[Dict[str, Any]] = []
    
    def add_turn(self, query: str, answer: str, context: Dict[str, Any]) -> None:
        """
        Add a conversation turn.
        
        Args:
            query: User query
            answer: System answer
            context: Additional context from the search
        """
        self.history.append({
            "query": query,
            "answer": answer,
            "context": context,
        })
        
        # Keep only max_turns
        if len(self.history) > self.max_turns:
            self.history = self.history[-self.max_turns:]
    
    def get_history(self) -> List[Dict[str, Any]]:
        """Get conversation history."""
        return self.history
    
    def clear(self) -> None:
        """Clear conversation history."""
        self.history = []


# ============================================================================
# SECTION 9: Example Usage
# ============================================================================

def example_usage():
    """
    Example usage of gRAG Query.
    
    This demonstrates how to:
    1. Load configuration
    2. Initialize query engine
    3. Perform different types of searches
    4. Generate follow-up questions
    5. Compare search methods
    """
    
    # Load configuration
    from gRAG_core import DefaultConfigMode
    
    config = DefaultConfigMode.load_from_yaml("settings.yaml")
    index_path = "output"
    
    # Initialize query engine
    query_engine = QueryEngine(config, index_path)
    
    # Load index
    query_engine.load_index()
    
    # Perform local search (entity-specific questions)
    local_result = query_engine.local_search(
        "What are the healing properties of chamomile?"
    )
    print(f"Local Search Answer: {local_result['answer']}")
    
    # Perform global search (dataset-wide questions)
    global_result = query_engine.global_search(
        "What are the most significant values of the herbs mentioned?"
    )
    print(f"Global Search Answer: {global_result['answer']}")
    
    # Perform DRIFT search (community-enhanced)
    drift_result = query_engine.drift_search(
        "How do different herbs interact in traditional medicine?"
    )
    print(f"DRIFT Search Answer: {drift_result['answer']}")
    
    # Perform basic search (vector RAG)
    basic_result = query_engine.basic_search(
        "Tell me about herbal remedies"
    )
    print(f"Basic Search Answer: {basic_result['answer']}")
    
    # Generate follow-up questions
    follow_ups = query_engine.generate_questions([
        "What are the healing properties of chamomile?",
        "How is chamomile used in traditional medicine?"
    ])
    print(f"Follow-up Questions: {follow_ups}")
    
    # Compare search methods
    comparator = SearchComparator(query_engine)
    comparison = comparator.compare_all("What are the healing properties of chamomile?")
    print(f"Comparison: {comparison.keys()}")


if __name__ == "__main__":
    example_usage()
