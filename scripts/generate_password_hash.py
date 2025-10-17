#!/usr/bin/env python3
"""
Generate bcrypt password hash for manual database updates.

Usage:
    python scripts/generate_password_hash.py
    
Or with password as argument:
    python scripts/generate_password_hash.py "my_password"
"""
import sys
from pathlib import Path

# Add parent directory to path to import server modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server.auth_utils import hash_password

def main():
    if len(sys.argv) > 1:
        password = sys.argv[1]
    else:
        import getpass
        password = getpass.getpass("Enter password to hash: ")
    
    if not password:
        print("Error: Password cannot be empty")
        sys.exit(1)
    
    hashed = hash_password(password)
    print(f"\nBcrypt hash generated:")
    print(hashed)
    print(f"\nSQL Update Example:")
    print(f"UPDATE users SET password_hash = '{hashed}' WHERE email = 'user@example.com';")

if __name__ == "__main__":
    main()

