
import sqlite3
import os
from contextlib import contextmanager

DATABASE_PATH = os.environ.get("DATABASE_PATH", "guadon.db")


@contextmanager
def get_db():
    conn = sqlite3.connect(DATABASE_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with get_db() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            telegram_id INTEGER PRIMARY KEY,
            username TEXT,
            balance INTEGER DEFAULT 0,
            total_clicks INTEGER DEFAULT 0,
            click_level INTEGER DEFAULT 1,
            is_banned INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS admins (
            telegram_id INTEGER PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS skins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            rarity TEXT DEFAULT 'Consumer',
            price INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price_dc INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            skin_id INTEGER NOT NULL,
            quantity INTEGER DEFAULT 1,
            acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, skin_id),
            FOREIGN KEY(user_id) REFERENCES users(telegram_id),
            FOREIGN KEY(skin_id) REFERENCES skins(id)
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            amount INTEGER,
            action TEXT,
            admin_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS admin_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER,
            action TEXT,
            target_id INTEGER,
            details TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # Добавляем недостающие поля в старые базы
        migrations = {
            "users": {
                "username": "TEXT",
                "balance": "INTEGER DEFAULT 0",
                "total_clicks": "INTEGER DEFAULT 0",
                "click_level": "INTEGER DEFAULT 1",
                "is_banned": "INTEGER DEFAULT 0",
                "created_at": "TIMESTAMP"
            },
            "skins": {
                "name": "TEXT",
                "rarity": "TEXT DEFAULT 'Consumer'",
                "price": "INTEGER DEFAULT 0"
            },
            "cases": {
                "name": "TEXT",
                "price_dc": "INTEGER DEFAULT 0"
            },
            "inventory": {
                "quantity": "INTEGER DEFAULT 1"
            }
        }

        for table, columns in migrations.items():
            existing = {
                row["name"]
                for row in db.execute(
                    f"PRAGMA table_info({table})"
                ).fetchall()
            }
            for column, definition in columns.items():
                if column not in existing:
                    db.execute(
                        f"ALTER TABLE {table} "
                        f"ADD COLUMN {column} {definition}"
                    )


def register_user(telegram_id, username=None):
    with get_db() as db:
        db.execute("""
            INSERT INTO users (telegram_id, username)
            VALUES (?, ?)
            ON CONFLICT(telegram_id)
            DO UPDATE SET username = excluded.username
        """, (telegram_id, username))


def add_admin(telegram_id):
    with get_db() as db:
        db.execute(
            "INSERT OR IGNORE INTO admins (telegram_id) VALUES (?)",
            (telegram_id,)
        )


def is_admin(telegram_id):
    with get_db() as db:
        result = db.execute(
            "SELECT 1 FROM admins WHERE telegram_id = ?",
            (telegram_id,)
        ).fetchone()
        return result is not None


def get_balance(telegram_id):
    with get_db() as db:
        result = db.execute(
            "SELECT balance FROM users WHERE telegram_id = ?",
            (telegram_id,)
        ).fetchone()
        return result["balance"] if result else 0


def change_balance(telegram_id, amount, action, admin_id=None):
    with get_db() as db:
        db.execute("""
            INSERT OR IGNORE INTO users (telegram_id)
            VALUES (?)
        """, (telegram_id,))

        current = db.execute(
            "SELECT balance FROM users WHERE telegram_id = ?",
            (telegram_id,)
        ).fetchone()["balance"]

        new_balance = current + int(amount)

        if new_balance < 0:
            raise ValueError("Недостаточно DC")

        db.execute(
            "UPDATE users SET balance = ? WHERE telegram_id = ?",
            (new_balance, telegram_id)
        )

        db.execute("""
            INSERT INTO transactions
            (user_id, amount, action, admin_id)
            VALUES (?, ?, ?, ?)
        """, (telegram_id, amount, action, admin_id))

        return new_balance


def add_skin(name, rarity, price):
    with get_db() as db:
        cursor = db.execute("""
            INSERT INTO skins (name, rarity, price)
            VALUES (?, ?, ?)
        """, (name, rarity, int(price)))
        return cursor.lastrowid


def get_all_skins():
    with get_db() as db:
        return [
            dict(row) for row in db.execute(
                "SELECT * FROM skins ORDER BY price DESC"
            ).fetchall()
        ]


def get_skin(skin_id):
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM skins WHERE id = ?",
            (skin_id,)
        ).fetchone()
        return dict(row) if row else None


def add_inventory_skin(user_id, skin_id, quantity=1):
    quantity = int(quantity)

    if quantity <= 0:
        raise ValueError("Количество должно быть больше нуля")

    with get_db() as db:
        db.execute("""
            INSERT INTO inventory (user_id, skin_id, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, skin_id)
            DO UPDATE SET quantity = quantity + excluded.quantity
        """, (user_id, skin_id, quantity))


def remove_inventory_skin(user_id, skin_id, quantity=1):
    quantity = int(quantity)

    if quantity <= 0:
        raise ValueError("Количество должно быть больше нуля")

    with get_db() as db:
        row = db.execute("""
            SELECT quantity FROM inventory
            WHERE user_id = ? AND skin_id = ?
        """, (user_id, skin_id)).fetchone()

        if not row or row["quantity"] < quantity:
            return False

        if row["quantity"] == quantity:
            db.execute("""
                DELETE FROM inventory
                WHERE user_id = ? AND skin_id = ?
            """, (user_id, skin_id))
        else:
            db.execute("""
                UPDATE inventory SET quantity = quantity - ?
                WHERE user_id = ? AND skin_id = ?
            """, (quantity, user_id, skin_id))

        return True


def get_inventory(user_id):
    with get_db() as db:
        rows = db.execute("""
            SELECT
                skins.id AS skin_id,
                skins.name,
                skins.rarity,
                skins.price,
                inventory.quantity
            FROM inventory
            JOIN skins ON skins.id = inventory.skin_id
            WHERE inventory.user_id = ?
            ORDER BY skins.price DESC
        """, (user_id,)).fetchall()

        return [dict(row) for row in rows]


def log_admin(admin_id, action, target_id=None, details=None):
    with get_db() as db:
        db.execute("""
            INSERT INTO admin_logs
            (admin_id, action, target_id, details)
            VALUES (?, ?, ?, ?)
        """, (admin_id, action, target_id, details))


def get_admin_logs(limit=100):
    with get_db() as db:
        rows = db.execute("""
            SELECT * FROM admin_logs
            ORDER BY id DESC LIMIT ?
        """, (int(limit),)).fetchall()

        return [dict(row) for row in rows]


init_db()
