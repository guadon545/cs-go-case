
import sqlite3
import os
from pathlib import Path

DB_PATH = Path(os.getenv(
    "DB_PATH",
    str(Path(__file__).parent / "guadon.db")
))


def connect():
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA foreign_keys = ON")
    return db


def init_db():
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            telegram_id INTEGER PRIMARY KEY,
            username TEXT,
            balance INTEGER NOT NULL DEFAULT 0,
            total_clicks INTEGER NOT NULL DEFAULT 0,
            click_level INTEGER NOT NULL DEFAULT 1,
            is_banned INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS admins (
            telegram_id INTEGER PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS skins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            rarity TEXT NOT NULL,
            price INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price_dc INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            skin_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(user_id) REFERENCES users(telegram_id),
            FOREIGN KEY(skin_id) REFERENCES skins(id),
            UNIQUE(user_id, skin_id)
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount INTEGER NOT NULL,
            action TEXT NOT NULL,
            admin_id INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS admin_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            target_user_id INTEGER,
            action TEXT NOT NULL,
            details TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        """)


def register_user(user_id, username=None):
    with connect() as db:
        db.execute(
            "INSERT OR IGNORE INTO users (telegram_id, username) VALUES (?, ?)",
            (user_id, username)
        )


def add_admin(user_id):
    with connect() as db:
        db.execute(
            "INSERT OR IGNORE INTO admins (telegram_id) VALUES (?)",
            (user_id,)
        )


def is_admin(user_id):
    with connect() as db:
        result = db.execute(
            "SELECT 1 FROM admins WHERE telegram_id = ?",
            (user_id,)
        ).fetchone()
        return result is not None


def get_balance(user_id):
    with connect() as db:
        result = db.execute(
            "SELECT balance FROM users WHERE telegram_id = ?",
            (user_id,)
        ).fetchone()
        return result[0] if result else 0


def change_balance(user_id, amount, action, admin_id=None):
    with connect() as db:
        db.execute(
            "INSERT OR IGNORE INTO users (telegram_id) VALUES (?)",
            (user_id,)
        )
        db.execute(
            "UPDATE users SET balance = balance + ? WHERE telegram_id = ?",
            (amount, user_id)
        )
        db.execute(
            """INSERT INTO transactions
            (user_id, amount, action, admin_id)
            VALUES (?, ?, ?, ?)""",
            (user_id, amount, action, admin_id)
        )


if __name__ == "__main__":
    init_db()
    add_admin(222619025)
    print("GUADON COIN DATABASE CREATED!")
