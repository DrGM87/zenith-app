"""
gRAG Visualizer Module
======================

This module provides visualization utilities for GraphRAG (Graph Retrieval-Augmented Generation).
Based on Microsoft GraphRAG documentation: https://microsoft.github.io/graphrag/visualization_guide/

This module helps you visualize and debug your knowledge graph after it's been constructed
by GraphRAG. The primary visualization tool recommended is Gephi, which supports the GraphML
file format exported by GraphRAG.

Visualization Process:
1. Enable GraphML snapshots in configuration
2. Run the indexing pipeline
3. Locate the graph.graphml file in the output directory
4. Import into Gephi for visualization
5. Apply statistics, clustering, and layout algorithms
6. Color and resize nodes for better visualization

Documentation Reference:
- Visualization Guide: https://microsoft.github.io/graphrag/visualization_guide/
- Gephi: https://gephi.org/
- GraphML Format: http://graphml.graphdrawing.org/

Author: GraphRAG Python Tools
Version: 1.0.0
"""

import os
import xml.etree.ElementTree as ET
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, field
from pathlib import Path
import json


# ============================================================================
# SECTION 1: Visualization Overview
# ============================================================================

class GraphVisualizer:
    """
    Main Graph Visualizer for GraphRAG.
    
    This class provides utilities to prepare and visualize knowledge graphs generated
    by GraphRAG. The primary output format is GraphML, which can be imported into
    visualization tools like Gephi.
    
    Reference: https://microsoft.github.io/graphrag/visualization_guide/
    """
    
    def __init__(self, output_dir: str = "output"):
        """
        Initialize the graph visualizer.
        
        Args:
            output_dir: Directory containing GraphRAG output (default: "output")
        """
        self.output_dir = output_dir
        self.graphml_path: Optional[str] = None
        self.graph_data: Optional[Dict[str, Any]] = None
    
    def enable_graphml_export(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Enable GraphML snapshot export in configuration.
        
        Before building an index, review your settings.yaml configuration file and
        ensure that graphml snapshots is enabled.
        
        Args:
            config: GraphRAG configuration dictionary
            
        Returns:
            Updated configuration with graphml enabled
        """
        if "snapshots" not in config:
            config["snapshots"] = {}
        
        config["snapshots"]["graphml"] = True
        return config
    
    def locate_graphml(self) -> Optional[str]:
        """
        Locate the GraphML file in the output directory.
        
        After running the indexing pipeline over your data, there will be an output
        folder (defined by the storage.base_dir setting). Look for a file named
        graph.graphml.
        
        Returns:
            Path to the graph.graphml file, or None if not found
        """
        graphml_path = os.path.join(self.output_dir, "graph.graphml")
        
        if os.path.exists(graphml_path):
            self.graphml_path = graphml_path
            return graphml_path
        
        # Search recursively
        for root, dirs, files in os.walk(self.output_dir):
            if "graph.graphml" in files:
                self.graphml_path = os.path.join(root, "graph.graphml")
                return self.graphml_path
        
        return None
    
    def load_graphml(self, graphml_path: Optional[str] = None) -> Dict[str, Any]:
        """
        Load GraphML file and parse graph data.
        
        Args:
            graphml_path: Path to GraphML file (uses located path if None)
            
        Returns:
            Dictionary containing graph data (nodes, edges, attributes)
        """
        if graphml_path is None:
            graphml_path = self.graphml_path
        
        if graphml_path is None or not os.path.exists(graphml_path):
            raise FileNotFoundError(f"GraphML file not found: {graphml_path}")
        
        tree = ET.parse(graphml_path)
        root = tree.getroot()
        
        # Parse namespace (GraphML uses namespaces)
        namespaces = {
            'graphml': 'http://graphml.graphdrawing.org/xmlns',
            'xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        }
        
        # Extract graph element
        graph = root.find('.//graphml:graph', namespaces)
        
        # Parse nodes and edges
        nodes = []
        edges = []
        
        for node in graph.findall('graphml:node', namespaces):
            node_id = node.get('id')
            node_data = {}
            
            for data in node.findall('graphml:data', namespaces):
                key = data.get('key')
                node_data[key] = data.text
            
            nodes.append({
                'id': node_id,
                'attributes': node_data,
            })
        
        for edge in graph.findall('graphml:edge', namespaces):
            source = edge.get('source')
            target = edge.get('target')
            edge_data = {}
            
            for data in edge.findall('graphml:data', namespaces):
                key = data.get('key')
                edge_data[key] = data.text
            
            edges.append({
                'source': source,
                'target': target,
                'attributes': edge_data,
            })
        
        self.graph_data = {
            'nodes': nodes,
            'edges': edges,
            'node_count': len(nodes),
            'edge_count': len(edges),
        }
        
        return self.graph_data
    
    def get_graph_statistics(self) -> Dict[str, Any]:
        """
        Calculate basic graph statistics.
        
        Returns:
            Dictionary with graph statistics
        """
        if self.graph_data is None:
            self.load_graphml()
        
        nodes = self.graph_data['nodes']
        edges = self.graph_data['edges']
        
        # Calculate degree for each node
        node_degrees = {}
        for node in nodes:
            node_id = node['id']
            node_degrees[node_id] = 0
        
        for edge in edges:
            node_degrees[edge['source']] = node_degrees.get(edge['source'], 0) + 1
            node_degrees[edge['target']] = node_degrees.get(edge['target'], 0) + 1
        
        # Calculate statistics
        degrees = list(node_degrees.values())
        
        return {
            'node_count': len(nodes),
            'edge_count': len(edges),
            'avg_degree': sum(degrees) / len(degrees) if degrees else 0,
            'max_degree': max(degrees) if degrees else 0,
            'min_degree': min(degrees) if degrees else 0,
            'node_degrees': node_degrees,
        }


# ============================================================================
# SECTION 2: Gephi Configuration
# ============================================================================

@dataclass
class GephiLayoutConfig:
    """
    Configuration for Gephi layout settings.
    
    Reference: https://microsoft.github.io/graphrag/visualization_guide/
    """
    # OpenORD layout
    openord_liquid: int = 50
    openord_expansion: int = 50
    openord_other: int = 0
    
    # ForceAtlas2 layout
    forceatlas2_scaling: int = 15
    forceatlas2_dissuade_hubs: bool = True
    forceatlas2_linlog_mode: bool = False
    forceatlas2_prevent_overlap: bool = True
    
    # Node sizing
    degree_min: int = 10
    degree_max: int = 150
    
    # Clustering
    leiden_resolution: int = 1
    leiden_quality_function: str = "modularity"


class GephiExporter:
    """
    Export graph data in formats compatible with Gephi.
    
    Provides utilities to prepare GraphRAG graphs for visualization in Gephi,
    including applying recommended settings for optimal visualization.
    
    Reference: https://microsoft.github.io/graphrag/visualization_guide/
    """
    
    def __init__(self, graph_data: Dict[str, Any]):
        """
        Initialize Gephi exporter.
        
        Args:
            graph_data: Graph data from GraphVisualizer
        """
        self.graph_data = graph_data
        self.layout_config = GephiLayoutConfig()
    
    def export_gephi_project_file(self, output_path: str) -> None:
        """
        Export as Gephi project file (.gephi).
        
        Args:
            output_path: Path to save the Gephi project file
        """
        # Placeholder implementation
        # Actual implementation would create a .gephi file with project settings
        pass
    
    def export_visualization_script(self, output_path: str) -> None:
        """
        Export a Python script for Gephi automation.
        
        Generates a Python script that can be run in Gephi's Python console
        to apply recommended visualization settings.
        
        Args:
            output_path: Path to save the visualization script
        """
        script = self._generate_gephi_script()
        with open(output_path, 'w') as f:
            f.write(script)
    
    def _generate_gephi_script(self) -> str:
        """Generate Gephi Python console script."""
        return '''# Gephi Visualization Script for GraphRAG
# Run this script in Gephi's Python console (Tools > Python Console)

# Step 1: Run Statistics
# Average Degree
average_degree = g.statistics().getAverageDegree()
average_degree.execute()

# Leiden Algorithm for community detection
leiden = g.statistics().getLeiden()
leiden.setResolution(1.0)  # Quality function: Modularity
leiden.execute()

# Step 2: Color Graph by Clusters
# Go to Appearance > Nodes > Partition
# Select "Cluster" from dropdown
# Click palette icon, generate colors
# Apply

# Step 3: Resize Nodes by Degree Centrality
# Go to Appearance > Nodes > Ranking
# Select "Sizing" icon
# Choose "Degree"
# Set Min: 10, Max: 150
# Apply

# Step 4: Layout the Graph
# OpenORD Layout
openord = g.layoutManager().getLayout('OpenOrd')
openord.setProperty('liquidStage', 50)
openord.setProperty('expansionStage', 50)
openord.execute()

# ForceAtlas2 Layout
forceatlas2 = g.layoutManager().getLayout('Force Atlas 2')
forceatlas2.setProperty('scaling', 15.0)
forceatlas2.setProperty('dissuadeHubs', True)
forceatlas2.setProperty('linLogMode', False)
forceatlas2.setProperty('preventOverlap', True)
forceatlas2.execute()

# Step 5: Add Text Labels (Optional)
# Turn on text labels in appropriate section
# Configure and resize as needed
'''


# ============================================================================
# SECTION 3: Graph Statistics
# ============================================================================

class GraphStatistics:
    """
    Calculate and analyze graph statistics.
    
    Provides comprehensive statistics about the knowledge graph including
    degree distribution, clustering, and centrality measures.
    """
    
    def __init__(self, graph_data: Dict[str, Any]):
        """
        Initialize graph statistics calculator.
        
        Args:
            graph_data: Graph data from GraphVisualizer
        """
        self.graph_data = graph_data
        self.node_degrees: Dict[str, int] = {}
        self.node_centrality: Dict[str, float] = {}
    
    def calculate_all_statistics(self) -> Dict[str, Any]:
        """
        Calculate all available graph statistics.
        
        Returns:
            Dictionary with all statistics
        """
        self._calculate_degrees()
        self._calculate_centrality()
        
        return {
            'basic_stats': self._basic_statistics(),
            'degree_distribution': self._degree_distribution(),
            'centrality': self._centrality_statistics(),
        }
    
    def _calculate_degrees(self) -> None:
        """Calculate degree for each node."""
        nodes = self.graph_data['nodes']
        edges = self.graph_data['edges']
        
        for node in nodes:
            self.node_degrees[node['id']] = 0
        
        for edge in edges:
            self.node_degrees[edge['source']] = self.node_degrees.get(edge['source'], 0) + 1
            self.node_degrees[edge['target']] = self.node_degrees.get(edge['target'], 0) + 1
    
    def _calculate_centrality(self) -> None:
        """Calculate centrality measures for each node."""
        # Degree centrality (normalized)
        max_degree = max(self.node_degrees.values()) if self.node_degrees else 1
        for node_id, degree in self.node_degrees.items():
            self.node_centrality[node_id] = degree / max_degree if max_degree > 0 else 0
    
    def _basic_statistics(self) -> Dict[str, Any]:
        """Calculate basic graph statistics."""
        degrees = list(self.node_degrees.values())
        
        return {
            'node_count': len(self.graph_data['nodes']),
            'edge_count': len(self.graph_data['edges']),
            'avg_degree': sum(degrees) / len(degrees) if degrees else 0,
            'max_degree': max(degrees) if degrees else 0,
            'min_degree': min(degrees) if degrees else 0,
            'density': (2 * len(self.graph_data['edges'])) / (len(self.graph_data['nodes']) * (len(self.graph_data['nodes']) - 1)) if len(self.graph_data['nodes']) > 1 else 0,
        }
    
    def _degree_distribution(self) -> Dict[str, Any]:
        """Calculate degree distribution statistics."""
        degrees = list(self.node_degrees.values())
        
        if not degrees:
            return {}
        
        # Sort degrees
        sorted_degrees = sorted(degrees)
        
        return {
            'median_degree': sorted_degrees[len(sorted_degrees) // 2],
            'degree_25th_percentile': sorted_degrees[len(sorted_degrees) // 4],
            'degree_75th_percentile': sorted_degrees[3 * len(sorted_degrees) // 4],
            'degree_distribution': self._degree_histogram(degrees),
        }
    
    def _degree_histogram(self, degrees: List[int], bins: int = 10) -> Dict[int, int]:
        """Create degree histogram."""
        if not degrees:
            return {}
        
        min_degree = min(degrees)
        max_degree = max(degrees)
        
        if min_degree == max_degree:
            return {min_degree: len(degrees)}
        
        bin_size = (max_degree - min_degree) / bins
        histogram = {}
        
        for degree in degrees:
            bin_key = int((degree - min_degree) / bin_size)
            histogram[bin_key] = histogram.get(bin_key, 0) + 1
        
        return histogram
    
    def _centrality_statistics(self) -> Dict[str, Any]:
        """Calculate centrality statistics."""
        centralities = list(self.node_centrality.values())
        
        if not centralities:
            return {}
        
        return {
            'max_centrality': max(centralities),
            'min_centrality': min(centralities),
            'avg_centrality': sum(centralities) / len(centralities),
            'top_central_nodes': self._get_top_central_nodes(10),
        }
    
    def _get_top_central_nodes(self, n: int) -> List[Tuple[str, float]]:
        """Get top n nodes by centrality."""
        sorted_nodes = sorted(
            self.node_centrality.items(),
            key=lambda x: x[1],
            reverse=True
        )
        return sorted_nodes[:n]


# ============================================================================
# SECTION 4: Community Detection
# ============================================================================

class CommunityDetector:
    """
    Detect communities in the knowledge graph.
    
    Uses the Leiden algorithm for community detection, which is the same
    algorithm used in GraphRAG's clustering step.
    
    Reference: https://microsoft.github.io/graphrag/visualization_guide/#4-install-the-leiden-algorithm-plugin
    """
    
    def __init__(self, graph_data: Dict[str, Any]):
        """
        Initialize community detector.
        
        Args:
            graph_data: Graph data from GraphVisualizer
        """
        self.graph_data = graph_data
        self.communities: Dict[str, List[str]] = {}
    
    def detect_leiden_communities(self, resolution: float = 1.0) -> Dict[str, List[str]]:
        """
        Detect communities using Leiden algorithm.
        
        Args:
            resolution: Resolution parameter for Leiden (higher = more communities)
            
        Returns:
            Dictionary mapping community IDs to lists of node IDs
        """
        # Placeholder implementation
        # Actual implementation would use python-louvain or similar
        # For now, return empty communities
        return {}
    
    def get_community_sizes(self) -> Dict[str, int]:
        """
        Get size of each community.
        
        Returns:
            Dictionary mapping community IDs to sizes
        """
        return {
            community_id: len(nodes)
            for community_id, nodes in self.communities.items()
        }
    
    def get_largest_community(self) -> Optional[str]:
        """
        Get the ID of the largest community.
        
        Returns:
            Community ID of largest community, or None if no communities
        """
        if not self.communities:
            return None
        
        return max(self.communities.items(), key=lambda x: len(x[1]))[0]


# ============================================================================
# SECTION 5: Graph Export Formats
# ============================================================================

class GraphExporter:
    """
    Export graph data in various formats.
    
    Supports exporting to GraphML, JSON, and other formats for different
    visualization tools and analysis purposes.
    """
    
    def __init__(self, graph_data: Dict[str, Any]):
        """
        Initialize graph exporter.
        
        Args:
            graph_data: Graph data from GraphVisualizer
        """
        self.graph_data = graph_data
    
    def export_json(self, output_path: str) -> None:
        """
        Export graph data to JSON format.
        
        Args:
            output_path: Path to save the JSON file
        """
        with open(output_path, 'w') as f:
            json.dump(self.graph_data, f, indent=2)
    
    def export_graphml(self, output_path: str) -> None:
        """
        Export graph data to GraphML format.
        
        Args:
            output_path: Path to save the GraphML file
        """
        # Build GraphML XML structure
        root = ET.Element('graphml')
        root.set('xmlns', 'http://graphml.graphdrawing.org/xmlns')
        root.set('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance')
        root.set('xsi:schemaLocation', 'http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd')
        
        # Add graph element
        graph = ET.SubElement(root, 'graph')
        graph.set('id', 'G')
        graph.set('edgedefault', 'undirected')
        
        # Add nodes
        for node in self.graph_data['nodes']:
            node_elem = ET.SubElement(graph, 'node')
            node_elem.set('id', node['id'])
            
            # Add attributes
            for key, value in node['attributes'].items():
                data = ET.SubElement(node_elem, 'data')
                data.set('key', key)
                data.text = str(value)
        
        # Add edges
        for edge in self.graph_data['edges']:
            edge_elem = ET.SubElement(graph, 'edge')
            edge_elem.set('source', edge['source'])
            edge_elem.set('target', edge['target'])
            
            # Add attributes
            for key, value in edge['attributes'].items():
                data = ET.SubElement(edge_elem, 'data')
                data.set('key', key)
                data.text = str(value)
        
        # Write to file
        tree = ET.ElementTree(root)
        tree.write(output_path, encoding='utf-8', xml_declaration=True)
    
    def export_csv_nodes(self, output_path: str) -> None:
        """
        Export nodes to CSV format.
        
        Args:
            output_path: Path to save the CSV file
        """
        import csv
        
        with open(output_path, 'w', newline='') as f:
            writer = csv.writer(f)
            
            # Write header
            header = ['id'] + list(self.graph_data['nodes'][0]['attributes'].keys())
            writer.writerow(header)
            
            # Write rows
            for node in self.graph_data['nodes']:
                row = [node['id']] + list(node['attributes'].values())
                writer.writerow(row)
    
    def export_csv_edges(self, output_path: str) -> None:
        """
        Export edges to CSV format.
        
        Args:
            output_path: Path to save the CSV file
        """
        import csv
        
        with open(output_path, 'w', newline='') as f:
            writer = csv.writer(f)
            
            # Write header
            if self.graph_data['edges']:
                header = ['source', 'target'] + list(self.graph_data['edges'][0]['attributes'].keys())
                writer.writerow(header)
                
                # Write rows
                for edge in self.graph_data['edges']:
                    row = [edge['source'], edge['target']] + list(edge['attributes'].values())
                    writer.writerow(row)


# ============================================================================
# SECTION 6: Visualization Guide Generator
# ============================================================================

class VisualizationGuideGenerator:
    """
    Generate step-by-step visualization guides.
    
    Creates customized guides based on the specific graph being visualized,
    with recommendations for optimal settings.
    """
    
    def __init__(self, graph_data: Dict[str, Any]):
        """
        Initialize guide generator.
        
        Args:
            graph_data: Graph data from GraphVisualizer
        """
        self.graph_data = graph_data
    
    def generate_gephi_guide(self) -> str:
        """
        Generate a step-by-step Gephi visualization guide.
        
        Returns:
            str: Complete visualization guide
        """
        guide = """# GraphRAG Knowledge Graph Visualization Guide

This guide walks through the process to visualize a knowledge graph after it's
been constructed by GraphRAG using Gephi.

## Prerequisites
- Gephi installed (https://gephi.org/)
- GraphRAG index completed with GraphML snapshots enabled
- graph.graphml file located in output directory

## Step 1: Enable GraphML Snapshots

Before building an index, review your settings.yaml configuration file and ensure
that graphml snapshots is enabled:

```yaml
snapshots:
  graphml: true
```

## Step 2: Run the Pipeline

After running the indexing pipeline over your data, there will be an output folder
(defined by the storage.base_dir setting).

## Step 3: Locate the Knowledge Graph

In the output folder, look for a file named `graph.graphml`. GraphML is a standard
file format supported by many visualization tools.

## Step 4: Open the Graph in Gephi

1. Install and open Gephi
2. Navigate to the `output` folder containing the various parquet files
3. Import the `graph.graphml` file into Gephi
4. This will result in a fairly plain view of the undirected graph nodes and edges

## Step 5: Install the Leiden Algorithm Plugin

1. Go to `Tools` -> `Plugins`
2. Search for "Leiden Algorithm"
3. Click `Install` and restart Gephi

## Step 6: Run Statistics

1. In the `Statistics` tab on the right, click `Run` for `Average Degree`
2. Click `Run` for `Leiden Algorithm`
3. For the Leiden Algorithm, adjust the settings:
   - Quality function: Modularity
   - Resolution: 1

## Step 7: Color the Graph by Clusters

1. Go to the `Appearance` pane in the upper left side of Gephi
2. Select `Nodes`, then `Partition`, and click the color palette icon in the upper right
3. Choose `Cluster` from the dropdown
4. Click the `Palette...` hyperlink, then `Generate...`
5. Uncheck `Limit number of colors`, click `Generate`, and then `Ok`
6. Click `Apply` to color the graph

## Step 8: Resize Nodes by Degree Centrality

1. In the `Appearance` pane in the upper left, select `Nodes` -> `Ranking`
2. Select the `Sizing` icon in the upper right
3. Choose `Degree` and set:
   - Min: 10
   - Max: 150
4. Click `Apply`

## Step 9: Layout the Graph

1. In the `Layout` tab in the lower left, select `OpenORD`
2. Set `Liquid` and `Expansion` stages to 50, and everything else to 0
3. Click `Run` and monitor the progress

## Step 10: Run ForceAtlas2

1. Select `Force Atlas 2` in the layout options
2. Adjust the settings:
   - Scaling: 15
   - Dissuade Hubs: checked
   - LinLog mode: uncheck
   - Prevent Overlap: checked
3. Click `Run` and wait
4. Press `Stop` when it looks like the graph nodes have settled

## Step 11: Add Text Labels (Optional)

1. Turn on text labels in the appropriate section
2. Configure and resize them as needed

Your final graph should now be visually organized and ready for analysis!
"""
        return guide
    
    def save_guide(self, output_path: str = "visualization_guide.md") -> None:
        """
        Save the visualization guide to a file.
        
        Args:
            output_path: Path to save the guide (default: "visualization_guide.md")
        """
        guide = self.generate_gephi_guide()
        with open(output_path, 'w') as f:
            f.write(guide)


# ============================================================================
# SECTION 7: Example Usage
# ============================================================================

def example_usage():
    """
    Example usage of gRAG Visualizer.
    
    This demonstrates how to:
    1. Enable GraphML export in configuration
    2. Locate and load the GraphML file
    3. Calculate graph statistics
    4. Export to different formats
    5. Generate visualization guide
    """
    
    # Load configuration
    from gRAG_core import DefaultConfigMode
    
    config = DefaultConfigMode.load_from_yaml("settings.yaml")
    output_dir = config.get("output", {}).get("storage", {}).get("base_dir", "output")
    
    # Initialize visualizer
    visualizer = GraphVisualizer(output_dir)
    
    # Enable GraphML export
    config = visualizer.enable_graphml_export(config)
    
    # Save updated config
    DefaultConfigMode.save_to_yaml(config, "settings.yaml")
    
    # After running indexing, locate GraphML file
    graphml_path = visualizer.locate_graphml()
    
    if graphml_path:
        print(f"GraphML file located: {graphml_path}")
        
        # Load graph data
        graph_data = visualizer.load_graphml()
        print(f"Loaded graph with {graph_data['node_count']} nodes and {graph_data['edge_count']} edges")
        
        # Calculate statistics
        stats = visualizer.get_graph_statistics()
        print(f"Average degree: {stats['avg_degree']:.2f}")
        print(f"Max degree: {stats['max_degree']}")
        
        # Calculate detailed statistics
        graph_stats = GraphStatistics(graph_data)
        all_stats = graph_stats.calculate_all_statistics()
        print(f"Graph density: {all_stats['basic_stats']['density']:.4f}")
        
        # Export to different formats
        exporter = GraphExporter(graph_data)
        exporter.export_json("graph_data.json")
        exporter.export_graphml("graph_export.graphml")
        exporter.export_csv_nodes("nodes.csv")
        exporter.export_csv_edges("edges.csv")
        
        print("Exported graph to JSON, GraphML, and CSV formats")
        
        # Generate Gephi visualization script
        gephi_exporter = GephiExporter(graph_data)
        gephi_exporter.export_visualization_script("gephi_visualization.py")
        
        print("Generated Gephi visualization script")
        
        # Generate visualization guide
        guide_generator = VisualizationGuideGenerator(graph_data)
        guide_generator.save_guide("visualization_guide.md")
        
        print("Generated visualization guide")
    else:
        print("GraphML file not found. Run indexing with graphml snapshots enabled first.")


if __name__ == "__main__":
    example_usage()
