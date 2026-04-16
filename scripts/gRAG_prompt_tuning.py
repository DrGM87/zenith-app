"""
gRAG Prompt Tuning Module
=========================

This module provides prompt tuning utilities for GraphRAG (Graph Retrieval-Augmented Generation).
Based on Microsoft GraphRAG documentation: https://microsoft.github.io/graphrag/prompt_tuning/overview/

Prompt tuning is essential for optimizing GraphRAG performance for specific domains.
This module provides:

- Default Prompts: Out-of-the-box prompts for general use
- Auto Tuning: Domain-adapted prompts generated from your data
- Manual Tuning: Advanced customization of prompts
- Document Selection: Methods to select representative documents for tuning

Auto Tuning is highly encouraged as it yields better results when executing an Index Run.

Documentation Reference:
- Prompt Tuning Overview: https://microsoft.github.io/graphrag/prompt_tuning/overview/
- Auto Prompt Tuning: https://microsoft.github.io/graphrag/prompt_tuning/auto_prompt_tuning/
- Manual Prompt Tuning: https://microsoft.github.io/graphrag/prompt_tuning/manual_prompt_tuning/

Author: GraphRAG Python Tools
Version: 1.0.0
"""

import os
import asyncio
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
import json


# ============================================================================
# SECTION 1: Prompt Tuning Overview
# ============================================================================

class PromptTuningMode(Enum):
    """
    Prompt tuning modes available in GraphRAG.
    
    Reference: https://microsoft.github.io/graphrag/prompt_tuning/overview/
    """
    DEFAULT = "default"  # Default prompts, works out-of-the-box
    AUTO = "auto"  # Domain-adapted prompts generated from data (recommended)
    MANUAL = "manual"  # Advanced manual customization


class PromptTuner:
    """
    Main Prompt Tuner for GraphRAG.
    
    GraphRAG provides the ability to create domain-adapted prompts for the generation
    of the knowledge graph. This step is optional, though it is highly encouraged to
    run it as it will yield better results when executing an Index Run.
    
    Tuning Process:
    1. Load input documents
    2. Split documents into chunks (text units)
    3. Run LLM invocations and template substitutions
    4. Generate final prompts for entity extraction, summarization, and community reporting
    
    Reference: https://microsoft.github.io/graphrag/prompt_tuning/auto_prompt_tuning/
    """
    
    def __init__(self, config: Dict[str, Any], root: str = "."):
        """
        Initialize the prompt tuner.
        
        Args:
            config: GraphRAG configuration dictionary (from gRAG_core.py)
            root: Root directory containing config file (default: current directory)
        """
        self.config = config
        self.root = root
        self.generated_prompts: Dict[str, str] = {}
    
    def auto_tune(self, **kwargs) -> Dict[str, str]:
        """
        Run automatic prompt tuning.
        
        Generates domain-adapted prompts from your input data.
        
        Args:
            **kwargs: Auto tuning parameters (see AutoPromptTuningConfig)
            
        Returns:
            Dict[str, str]: Generated prompts keyed by prompt type
        """
        tuning_config = AutoPromptTuningConfig(**kwargs)
        
        # Load input documents
        documents = self._load_documents(tuning_config)
        
        # Split into chunks
        text_units = self._split_into_chunks(documents, tuning_config)
        
        # Select sample for tuning
        sample_units = self._select_sample(text_units, tuning_config)
        
        # Generate prompts
        self.generated_prompts = {
            "extract_graph": self._generate_extract_graph_prompt(sample_units, tuning_config),
            "summarize_descriptions": self._generate_summarize_descriptions_prompt(sample_units, tuning_config),
            "community_report": self._generate_community_report_prompt(sample_units, tuning_config),
        }
        
        return self.generated_prompts
    
    def save_prompts(self, output_dir: str = "prompts") -> None:
        """
        Save generated prompts to files.
        
        Args:
            output_dir: Directory to save prompts (default: "prompts")
        """
        os.makedirs(output_dir, exist_ok=True)
        
        for prompt_name, prompt_content in self.generated_prompts.items():
            output_path = os.path.join(output_dir, f"{prompt_name}.txt")
            with open(output_path, 'w') as f:
                f.write(prompt_content)
    
    def update_config(self, config_path: str = "settings.yaml") -> None:
        """
        Update configuration to use generated prompts.
        
        Args:
            config_path: Path to configuration file
        """
        from gRAG_core import DefaultConfigMode
        
        # Load existing config
        if config_path.endswith(".yaml") or config_path.endswith(".yml"):
            config = DefaultConfigMode.load_from_yaml(config_path)
        else:
            config = DefaultConfigMode.load_from_json(config_path)
        
        # Update prompt paths
        if "extract_graph" in config:
            config["extract_graph"]["prompt"] = "prompts/extract_graph.txt"
        if "summarize_descriptions" in config:
            config["summarize_descriptions"]["prompt"] = "prompts/summarize_descriptions.txt"
        if "community_reports" in config:
            config["community_reports"]["prompt"] = "prompts/community_report.txt"
        
        # Save updated config
        if config_path.endswith(".yaml") or config_path.endswith(".yml"):
            DefaultConfigMode.save_to_yaml(config, config_path)
        else:
            DefaultConfigMode.save_to_json(config, config_path)
    
    def _load_documents(self, config: 'AutoPromptTuningConfig') -> List[Dict[str, Any]]:
        """Load input documents based on configuration."""
        # Placeholder implementation
        # Actual implementation would load documents from input config
        return []
    
    def _split_into_chunks(
        self,
        documents: List[Dict[str, Any]],
        config: 'AutoPromptTuningConfig'
    ) -> List[Dict[str, Any]]:
        """Split documents into text units."""
        # Placeholder implementation
        return []
    
    def _select_sample(
        self,
        text_units: List[Dict[str, Any]],
        config: 'AutoPromptTuningConfig'
    ) -> List[Dict[str, Any]]:
        """Select sample of text units based on selection method."""
        # Placeholder implementation
        return []
    
    def _generate_extract_graph_prompt(
        self,
        sample_units: List[Dict[str, Any]],
        config: 'AutoPromptTuningConfig'
    ) -> str:
        """Generate entity extraction prompt."""
        # Placeholder implementation
        # Actual implementation would:
        # 1. Extract examples from sample units
        # 2. Use LLM to generate domain-specific prompt
        return ""
    
    def _generate_summarize_descriptions_prompt(
        self,
        sample_units: List[Dict[str, Any]],
        config: 'AutoPromptTuningConfig'
    ) -> str:
        """Generate description summarization prompt."""
        # Placeholder implementation
        return ""
    
    def _generate_community_report_prompt(
        self,
        sample_units: List[Dict[str, Any]],
        config: 'AutoPromptTuningConfig'
    ) -> str:
        """Generate community reporting prompt."""
        # Placeholder implementation
        return ""


# ============================================================================
# SECTION 2: Auto Prompt Tuning Configuration
# ============================================================================

@dataclass
class AutoPromptTuningConfig:
    """
    Configuration for automatic prompt tuning.
    
    GraphRAG provides the ability to create domain-adapted prompts for the
    generation of the knowledge graph. These are generated by loading the inputs,
    splitting them into chunks (text units) and then running a series of LLM
    invocations and template substitutions to generate the final prompts.
    
    Reference: https://microsoft.github.io/graphrag/prompt_tuning/auto_prompt_tuning/
    """
    # Basic parameters
    root: str = "."  # Path to project directory with config file
    domain: str = ""  # Domain related to input data (e.g., "space science", "microbiology")
    
    # Document selection
    selection_method: str = "random"  # all, random, auto, top
    limit: int = 15  # Limit of text units for random/top selection
    language: str = ""  # Language for input processing (empty = auto-detect)
    
    # Chunking parameters
    max_tokens: int = 2000  # Maximum token count for prompt generation
    chunk_size: int = 200  # Size in tokens for text units
    
    # Auto selection parameters
    n_subset_max: int = 300  # Number of text chunks to embed for auto selection
    k: int = 15  # Number of documents to select for auto selection
    
    # Entity extraction parameters
    min_examples_required: int = 2  # Minimum examples required for entity extraction prompts
    discover_entity_types: bool = False  # Allow LLM to discover entity types automatically
    
    # Output
    output: str = "prompts"  # Folder to save generated prompts


class DocumentSelectionMethod(Enum):
    """
    Document selection methods for auto tuning.
    
    The auto tuning feature ingests the input data and then divides it into text
    units the size of the chunk size parameter. After that, it uses one of the
    following selection methods to pick a sample to work with for prompt generation.
    
    Reference: https://microsoft.github.io/graphrag/prompt_tuning/auto_prompt_tuning/#document-selection-methods
    """
    RANDOM = "random"  # Select text units randomly (default, recommended)
    TOP = "top"  # Select the head n text units
    ALL = "all"  # Use all text units (not recommended for large datasets)
    AUTO = "auto"  # Embed text units and select k nearest neighbors to centroid


class DocumentSelector:
    """
    Select documents for prompt tuning.
    
    Implements different selection methods to pick a representative sample
    of documents for prompt generation.
    
    Reference: https://microsoft.github.io/graphrag/prompt_tuning/auto_prompt_tuning/#document-selection-methods
    """
    
    def __init__(self, method: DocumentSelectionMethod = DocumentSelectionMethod.RANDOM):
        """
        Initialize document selector.
        
        Args:
            method: Selection method to use
        """
        self.method = method
    
    def select(
        self,
        text_units: List[Dict[str, Any]],
        limit: int = 15,
        k: int = 15,
        n_subset_max: int = 300
    ) -> List[Dict[str, Any]]:
        """
        Select documents based on configured method.
        
        Args:
            text_units: All text units to select from
            limit: Limit for random/top selection
            k: Number of documents for auto selection
            n_subset_max: Number of chunks to embed for auto selection
            
        Returns:
            List of selected text units
        """
        if self.method == DocumentSelectionMethod.RANDOM:
            return self._select_random(text_units, limit)
        elif self.method == DocumentSelectionMethod.TOP:
            return self._select_top(text_units, limit)
        elif self.method == DocumentSelectionMethod.ALL:
            return text_units
        elif self.method == DocumentSelectionMethod.AUTO:
            return self._select_auto(text_units, k, n_subset_max)
        else:
            raise ValueError(f"Unknown selection method: {self.method}")
    
    def _select_random(self, text_units: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
        """Randomly select text units."""
        # Placeholder implementation
        # Actual implementation would use random.sample
        return text_units[:limit]
    
    def _select_top(self, text_units: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
        """Select the head n text units."""
        return text_units[:limit]
    
    def _select_auto(
        self,
        text_units: List[Dict[str, Any]],
        k: int,
        n_subset_max: int
    ) -> List[Dict[str, Any]]:
        """
        Select using embedding-based clustering.
        
        Embed text units in lower-dimensional space and select k nearest
        neighbors to the centroid.
        """
        # Placeholder implementation
        # Actual implementation would:
        # 1. Embed subset of text units
        # 2. Compute centroid
        # 3. Select k nearest neighbors to centroid
        return text_units[:k]


# ============================================================================
# SECTION 3: Default Prompts
# ============================================================================

class DefaultPrompts:
    """
    Default prompts for GraphRAG.
    
    The default prompts are the simplest way to get started with the GraphRAG system.
    They are designed to work out-of-the-box with minimal configuration.
    
    Reference: https://microsoft.github.io/graphrag/prompt_tuning/overview/#default-prompts
    """
    
    @staticmethod
    def get_extract_graph_prompt() -> str:
        """
        Get the default entity extraction prompt.
        
        Returns:
            str: Default extract_graph prompt content
        """
        return """# Graph Extraction Prompt

You are an AI assistant designed to extract entities and relationships from text.

## Instructions
1. Identify all entities mentioned in the text
2. Identify relationships between these entities
3. Extract the type and description for each entity and relationship

## Output Format
Provide the extraction in the following format:
- Entity: [name] | Type: [type] | Description: [description]
- Relationship: [source] -> [target] | Type: [type] | Description: [description]

## Example Text
[Your example text here]

## Extraction
[Extraction results here]"""
    
    @staticmethod
    def get_summarize_descriptions_prompt() -> str:
        """
        Get the default description summarization prompt.
        
        Returns:
            str: Default summarize_descriptions prompt content
        """
        return """# Description Summarization Prompt

You are an AI assistant designed to consolidate multiple descriptions into a single summary.

## Instructions
1. Review all provided descriptions for the entity or relationship
2. Identify common themes and key information
3. Create a concise summary that captures the essential information
4. Keep the summary under the specified token limit

## Output Format
Provide the summary in a clear, concise manner.

## Input Descriptions
[Your input descriptions here]

## Summary
[Your summary here]"""
    
    @staticmethod
    def get_community_report_prompt() -> str:
        """
        Get the default community reporting prompt.
        
        Returns:
            str: Default community_report prompt content
        """
        return """# Community Report Prompt

You are an AI assistant designed to generate comprehensive reports for communities of entities.

## Instructions
1. Analyze the community structure and relationships
2. Identify key themes and patterns within the community
3. Summarize the community's role and significance
4. Highlight important connections and insights
5. Keep the report under the specified token limit

## Output Format
Generate a structured report with:
- Community Overview
- Key Themes
- Important Connections
- Significant Insights

## Community Data
[Your community data here]

## Report
[Your report here]"""
    
    @staticmethod
    def get_local_search_prompt() -> str:
        """
        Get the default local search prompt.
        
        Returns:
            str: Default local_search prompt content
        """
        return """# Local Search Prompt

You are an AI assistant designed to answer questions based on provided context.

## Instructions
1. Review the provided context which includes entities, relationships, and text units
2. Identify relevant information related to the query
3. Synthesize a comprehensive answer using the relevant context
4. Cite the sources of information when possible

## Query
[User query here]

## Context
[Provided context here]

## Answer
[Your answer here]"""
    
    @staticmethod
    def get_global_search_prompt() -> str:
        """
        Get the default global search prompt.
        
        Returns:
            str: Default global_search prompt content
        """
        return """# Global Search Prompt

You are an AI assistant designed to answer questions based on community reports.

## Instructions
1. Review the provided community reports
2. Identify information relevant to the query across multiple communities
3. Synthesize a comprehensive answer that reflects the dataset as a whole
4. Highlight key insights and patterns

## Query
[User query here]

## Community Reports
[Provided community reports here]

## Answer
[Your answer here]"""
    
    @staticmethod
    def save_default_prompts(output_dir: str = "prompts") -> None:
        """
        Save all default prompts to files.
        
        Args:
            output_dir: Directory to save prompts (default: "prompts")
        """
        os.makedirs(output_dir, exist_ok=True)
        
        prompts = {
            "extract_graph.txt": DefaultPrompts.get_extract_graph_prompt(),
            "summarize_descriptions.txt": DefaultPrompts.get_summarize_descriptions_prompt(),
            "community_report.txt": DefaultPrompts.get_community_report_prompt(),
            "local_search.txt": DefaultPrompts.get_local_search_prompt(),
            "global_search.txt": DefaultPrompts.get_global_search_prompt(),
        }
        
        for filename, content in prompts.items():
            output_path = os.path.join(output_dir, filename)
            with open(output_path, 'w') as f:
                f.write(content)


# ============================================================================
# SECTION 4: Manual Prompt Tuning
# ============================================================================

class ManualPromptTuner:
    """
    Manual prompt tuner for advanced customization.
    
    Manual tuning is an advanced use-case. Most users will want to use the
    Auto Tuning feature instead. This class provides utilities for manual
    prompt customization.
    
    Reference: https://microsoft.github.io/graphrag/prompt_tuning/manual_prompt_tuning/
    """
    
    def __init__(self):
        """Initialize manual prompt tuner."""
        self.custom_prompts: Dict[str, str] = {}
    
    def set_prompt(self, prompt_type: str, prompt_content: str) -> None:
        """
        Set a custom prompt for a specific type.
        
        Args:
            prompt_type: Type of prompt (extract_graph, summarize_descriptions, etc.)
            prompt_content: Custom prompt content
        """
        self.custom_prompts[prompt_type] = prompt_content
    
    def get_prompt(self, prompt_type: str) -> Optional[str]:
        """
        Get a custom prompt by type.
        
        Args:
            prompt_type: Type of prompt
            
        Returns:
            Custom prompt content or None if not set
        """
        return self.custom_prompts.get(prompt_type)
    
    def load_from_file(self, prompt_type: str, file_path: str) -> None:
        """
        Load a custom prompt from a file.
        
        Args:
            prompt_type: Type of prompt
            file_path: Path to the prompt file
        """
        with open(file_path, 'r') as f:
            self.custom_prompts[prompt_type] = f.read()
    
    def save_to_file(self, prompt_type: str, file_path: str) -> None:
        """
        Save a custom prompt to a file.
        
        Args:
            prompt_type: Type of prompt
            file_path: Path to save the prompt file
        """
        if prompt_type not in self.custom_prompts:
            raise ValueError(f"No custom prompt set for type: {prompt_type}")
        
        with open(file_path, 'w') as f:
            f.write(self.custom_prompts[prompt_type])
    
    def validate_prompt(self, prompt_type: str, prompt_content: str) -> Tuple[bool, List[str]]:
        """
        Validate a prompt for required elements.
        
        Args:
            prompt_type: Type of prompt
            prompt_content: Prompt content to validate
            
        Returns:
            Tuple of (is_valid, list_of_issues)
        """
        issues = []
        
        # Check for required placeholders
        if prompt_type == "extract_graph":
            if "{text}" not in prompt_content:
                issues.append("Missing {text} placeholder")
        elif prompt_type == "summarize_descriptions":
            if "{descriptions}" not in prompt_content:
                issues.append("Missing {descriptions} placeholder")
        elif prompt_type == "community_report":
            if "{community_data}" not in prompt_content:
                issues.append("Missing {community_data} placeholder")
        
        return len(issues) == 0, issues


# ============================================================================
# SECTION 5: CLI Interface
# ============================================================================

class PromptTuningCLI:
    """
    Command-line interface for prompt tuning.
    
    Provides CLI-style access to prompt tuning functionality.
    
    Reference: https://microsoft.github.io/graphrag/prompt_tuning/auto_prompt_tuning/#usage
    """
    
    @staticmethod
    def prompt_tune(
        root: str = ".",
        domain: str = "",
        selection_method: str = "random",
        limit: int = 15,
        language: str = "",
        max_tokens: int = 2000,
        chunk_size: int = 200,
        n_subset_max: int = 300,
        k: int = 15,
        min_examples_required: int = 2,
        discover_entity_types: bool = False,
        output: str = "prompts"
    ) -> Dict[str, Any]:
        """
        Run prompt tuning from command line.
        
        Args:
            root: Path to project directory with config file
            domain: Domain related to input data
            selection_method: Document selection method (random, auto, top, all)
            limit: Limit for random/top selection
            language: Language for input processing
            max_tokens: Maximum token count for prompt generation
            chunk_size: Size in tokens for text units
            n_subset_max: Number of chunks to embed for auto selection
            k: Number of documents for auto selection
            min_examples_required: Minimum examples for entity extraction
            discover_entity_types: Allow LLM to discover entity types
            output: Folder to save generated prompts
            
        Returns:
            Dict[str, Any]: Tuning results
        """
        # Load configuration
        from gRAG_core import DefaultConfigMode
        
        config_path = os.path.join(root, "settings.yaml")
        if os.path.exists(config_path):
            config = DefaultConfigMode.load_from_yaml(config_path)
        else:
            config = DefaultConfigMode.create_default_config()
        
        # Initialize prompt tuner
        tuner = PromptTuner(config, root)
        
        # Run auto tuning
        generated_prompts = tuner.auto_tune(
            domain=domain,
            selection_method=selection_method,
            limit=limit,
            language=language,
            max_tokens=max_tokens,
            chunk_size=chunk_size,
            n_subset_max=n_subset_max,
            k=k,
            min_examples_required=min_examples_required,
            discover_entity_types=discover_entity_types,
        )
        
        # Save prompts
        tuner.save_prompts(output)
        
        # Update config
        tuner.update_config(config_path)
        
        return {
            "status": "completed",
            "prompts_generated": len(generated_prompts),
            "output_directory": output,
            "config_updated": True,
        }


# ============================================================================
# SECTION 6: Prompt Template Manager
# ============================================================================

class PromptTemplateManager:
    """
    Manage prompt templates with variable substitution.
    
    Provides utilities for loading, editing, and substituting variables in
    prompt templates.
    """
    
    def __init__(self):
        """Initialize prompt template manager."""
        self.templates: Dict[str, str] = {}
    
    def load_template(self, template_name: str, template_path: str) -> None:
        """
        Load a prompt template from file.
        
        Args:
            template_name: Name to assign to the template
            template_path: Path to the template file
        """
        with open(template_path, 'r') as f:
            self.templates[template_name] = f.read()
    
    def get_template(self, template_name: str) -> Optional[str]:
        """
        Get a prompt template by name.
        
        Args:
            template_name: Name of the template
            
        Returns:
            Template content or None if not found
        """
        return self.templates.get(template_name)
    
    def substitute_variables(
        self,
        template_name: str,
        variables: Dict[str, str]
    ) -> str:
        """
        Substitute variables in a template.
        
        Args:
            template_name: Name of the template
            variables: Dictionary of variable names to values
            
        Returns:
            Template with variables substituted
        """
        template = self.get_template(template_name)
        if template is None:
            raise ValueError(f"Template not found: {template_name}")
        
        result = template
        for key, value in variables.items():
            result = result.replace(f"{{{key}}}", value)
        
        return result
    
    def edit_template(self, template_name: str, new_content: str) -> None:
        """
        Edit a template's content.
        
        Args:
            template_name: Name of the template
            new_content: New template content
        """
        self.templates[template_name] = new_content
    
    def save_template(self, template_name: str, output_path: str) -> None:
        """
        Save a template to a file.
        
        Args:
            template_name: Name of the template
            output_path: Path to save the template
        """
        content = self.get_template(template_name)
        if content is None:
            raise ValueError(f"Template not found: {template_name}")
        
        with open(output_path, 'w') as f:
            f.write(content)


# ============================================================================
# SECTION 7: Example Usage
# ============================================================================

def example_usage():
    """
    Example usage of gRAG Prompt Tuning.
    
    This demonstrates how to:
    1. Use default prompts
    2. Run automatic prompt tuning
    3. Use manual prompt tuning
    4. Manage prompt templates
    5. Use CLI interface
    """
    
    # Load configuration
    from gRAG_core import DefaultConfigMode
    
    config = DefaultConfigMode.load_from_yaml("settings.yaml")
    
    # Option 1: Use default prompts
    DefaultPrompts.save_default_prompts("prompts")
    print("Default prompts saved to prompts/")
    
    # Option 2: Run automatic prompt tuning
    tuner = PromptTuner(config, root=".")
    generated_prompts = tuner.auto_tune(
        domain="environmental news",
        selection_method="random",
        limit=10,
        language="English",
        max_tokens=2048,
        chunk_size=256,
        min_examples_required=3,
        discover_entity_types=False,
    )
    
    tuner.save_prompts("prompts")
    tuner.update_config("settings.yaml")
    print(f"Generated {len(generated_prompts)} prompts")
    
    # Option 3: Manual prompt tuning
    manual_tuner = ManualPromptTuner()
    manual_tuner.set_prompt("extract_graph", "Custom extraction prompt...")
    manual_tuner.save_to_file("extract_graph", "prompts/custom_extract_graph.txt")
    
    # Validate custom prompt
    is_valid, issues = manual_tuner.validate_prompt("extract_graph", "Custom extraction prompt...")
    print(f"Prompt valid: {is_valid}, Issues: {issues}")
    
    # Option 4: Use CLI interface
    cli_result = PromptTuningCLI.prompt_tune(
        root=".",
        domain="space science",
        selection_method="random",
        limit=10,
        output="prompts"
    )
    print(f"CLI result: {cli_result}")


if __name__ == "__main__":
    example_usage()
