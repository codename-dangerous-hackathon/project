import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "anchor_local.db")

def init_db():
    """Initializes the local SQLite database for relational metadata."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Create Caregivers Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS caregivers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            relationship TEXT NOT NULL,
            phone_number TEXT
        )
    """)

    # Create Patients Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS patients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            primary_caregiver_id INTEGER,
            FOREIGN KEY(primary_caregiver_id) REFERENCES caregivers(id)
        )
    """)

    # Create Appointments Table (For Daily Briefing)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS appointments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER,
            time_str TEXT NOT NULL,
            description TEXT NOT NULL,
            FOREIGN KEY(patient_id) REFERENCES patients(id)
        )
    """)

    # Create Mood Logs (Privacy-preserving daily rollup)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS mood_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            mood_category TEXT NOT NULL,  -- Good, OK, Not great
            notes TEXT,
            FOREIGN KEY(patient_id) REFERENCES patients(id)
        )
    """)

    # Create Enrolled Faces metadata mappings (links VectorDB entry to a person name)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS enrolled_faces (
            id TEXT PRIMARY KEY, -- Maps to ChromaDB ID
            name TEXT NOT NULL,
            relationship TEXT NOT NULL,
            caregiver_id INTEGER,
            FOREIGN KEY(caregiver_id) REFERENCES caregivers(id)
        )
    """)

    conn.commit()
    conn.close()

# Initialize DB on load
init_db()

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn
