#!/usr/bin/env python3
"""
Script to improve CSV export structure and make it more professional.
"""

import json
import csv
import os
from pathlib import Path
import re

def clean_filename_component(text):
    """Clean text for use in filename - remove special chars and spaces"""
    return re.sub(r'[^\w\s-]', '', text).strip().replace(' ', '_')

def improve_csv_structure(csv_path, run_dir):
    """Improve the CSV structure and create a better organized file"""
    
    # Read the current CSV
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    
    if not rows:
        print("No data found in CSV")
        return
    
    # Get project and run info
    meta_path = os.path.join(run_dir, 'meta.json')
    persona_resolution_path = os.path.join(run_dir, 'tests', 'persona_resolution.json')
    
    project_name = "Unknown_Project"
    run_id = os.path.basename(run_dir)
    
    if os.path.exists(meta_path):
        with open(meta_path, 'r') as f:
            meta = json.load(f)
            project_name = clean_filename_component(meta.get('page', 'Unknown_Project'))
    
    # Get persona names
    persona_names = []
    if os.path.exists(persona_resolution_path):
        with open(persona_resolution_path, 'r') as f:
            persona_data = json.load(f)
            persona_names = [p['name'] for p in persona_data.get('personas', [])]
    
    # Create improved structure
    improved_data = []
    
    # Process individual user rows (exclude summary rows)
    for row in rows:
        if row.get('persona_id') == 'ALL':
            continue
            
        # Extract persona info once per persona
        persona_id = row.get('persona_id', '')
        persona_name = row.get('persona_name', '')
        
        # Create a cleaner row structure
        improved_row = {
            'User_ID': row.get('persona_id', ''),
            'Persona_Name': persona_name,
            'Status': row.get('status', '').title(),
            'Steps': row.get('steps', ''),
            'Time_Seconds': row.get('time_sec', ''),
            'Source_Screen_ID': row.get('source_id', ''),
            'Target_Screen_ID': row.get('target_id', ''),
            'Friction_Count': row.get('friction_count', ''),
            'Dropoff_Count': row.get('dropoff_count', ''),
            'Feedback_Count': row.get('feedback_count', ''),
            'Friction_Types': row.get('friction_types', ''),
            'Dropoff_Reasons': row.get('dropoff_reasons', ''),
            'Actions_Path': row.get('actions_path', ''),
            'User_Report_Text': row.get('user_report_text', ''),
            'Simulation_Directory': row.get('sim_dir', '')
        }
        
        improved_data.append(improved_row)
    
    # Add summary information as a separate section
    summary_rows = [row for row in rows if row.get('persona_id') == 'ALL']
    if summary_rows:
        summary_row = summary_rows[0]
        improved_data.append({
            'User_ID': 'SUMMARY',
            'Persona_Name': 'ALL_PERSONAS',
            'Status': 'COMPLETED',
            'Steps': summary_row.get('steps', ''),
            'Time_Seconds': summary_row.get('time_sec', ''),
            'Source_Screen_ID': '',
            'Target_Screen_ID': '',
            'Friction_Count': summary_row.get('friction_count', ''),
            'Dropoff_Count': summary_row.get('dropoff_count', ''),
            'Feedback_Count': summary_row.get('feedback_count', ''),
            'Friction_Types': summary_row.get('friction_types', ''),
            'Dropoff_Reasons': summary_row.get('dropoff_reasons', ''),
            'Actions_Path': '',
            'User_Report_Text': summary_row.get('user_report_text', ''),
            'Simulation_Directory': ''
        })
    
    # Create new filename
    persona_names_str = '_'.join([clean_filename_component(name) for name in persona_names[:3]])  # Limit to 3 names
    if not persona_names_str:
        persona_names_str = 'Multiple_Personas'
    
    new_filename = f"Users_{persona_names_str}_{project_name}_{run_id}.csv"
    new_path = os.path.join(run_dir, 'tests', new_filename)
    
    # Write improved CSV
    if improved_data:
        fieldnames = list(improved_data[0].keys())
        
        with open(new_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(improved_data)
        
        print(f"✅ Created improved CSV: {new_filename}")
        print(f"📁 Location: {new_path}")
        print(f"📊 Rows: {len(improved_data)}")
        
        # Show first few rows as preview
        print("\n📋 Preview of improved structure:")
        for i, row in enumerate(improved_data[:3]):
            print(f"Row {i+1}: {row['User_ID']} | {row['Persona_Name']} | {row['Status']} | {row['Steps']} steps")
        
        if len(improved_data) > 3:
            print(f"... and {len(improved_data) - 3} more rows")
            
        return new_path
    else:
        print("❌ No data to process")
        return None

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) != 3:
        print("Usage: python improve_csv_export.py <csv_path> <run_dir>")
        sys.exit(1)
    
    csv_path = sys.argv[1]
    run_dir = sys.argv[2]
    
    if not os.path.exists(csv_path):
        print(f"❌ CSV file not found: {csv_path}")
        sys.exit(1)
    
    if not os.path.exists(run_dir):
        print(f"❌ Run directory not found: {run_dir}")
        sys.exit(1)
    
    improve_csv_structure(csv_path, run_dir)
