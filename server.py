
import os
import hmac
import hashlib
import json
import time
import base64
import random

from urllib.parse import parse_qsl
from flask import Flask, request, jsonify
from flask_cors import CORS
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

import database


app = Flask(__name__)

CORS(
    app,
    origins=["https://guadon545.github.io"],
    allow_headers=["Content-Type", "X-Telegram-Init-Data"],
    methods=["GET", "POST", "OPTIONS"]
)

database.init_db()

admin_ids = os.getenv("ADMIN_IDS", "")

for admin_id in admin_ids.split(","):
    if admin_id.strip().isdigit():
        database.add_admin(int(admin_id.strip()))

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()

TELEGRAM_PUBLIC_KEY = bytes.fromhex(
    "e7bf03a2fa4602af4580703d88dda5bb"
    "59f32ed8b02a56c187fe7d34caed242d"
)


# -------------------------
# TELEGRAM AUTH
# -------------------------

def verify_telegram_data(init_data):
    if not BOT_TOKEN or not init_data:
        return None

    try:
        data = dict(parse_qsl(init_data, keep_blank_values=True))

        auth_date = int(data.get("auth_date", "0"))

        if auth_date > time.time() + 60:
            return None

        if time.time() - auth_date > 86400:
            return None

        received_hash = data.get("hash")

        if received_hash:
            check_data = {
                key: value
                for key, value in data.items()
                if key != "hash"
            }

            check_string = "\n".join(
                f"{key}={value}"
                for key, value in sorted(check_data.items())
            )

            secret_key = hmac.new(
                b"WebAppData",
                BOT_TOKEN.encode(),
                hashlib.sha256
            ).digest()

            calculated_hash = hmac.new(
                secret_key,
                check_string.encode(),
                hashlib.sha256
            ).hexdigest()

            if not hmac.compare_digest(
                calculated_hash,
                received_hash
            ):
                return None

        else:
            signature = data.get("signature")

            if not signature:
                return None

            bot_id = BOT_TOKEN.split(":")[0]

            check_data = {
                key: value
                for key, value in data.items()
                if key not in ("hash", "signature")
            }

            check_string = (
                f"{bot_id}:WebAppData\n"
                + "\n".join(
                    f"{key}={value}"
                    for key, value in sorted(check_data.items())
                )
            )

            signature_bytes = base64.urlsafe_b64decode(
                signature + "=" * (-len(signature) % 4)
            )

            public_key = Ed25519PublicKey.from_public_bytes(
                TELEGRAM_PUBLIC_KEY
            )

            public_key.verify(
                signature_bytes,
                check_string.encode()
            )

        return json.loads(data["user"])

    except Exception as error:
        print("AUTH DEBUG:", type(error).__name__)
        return None


def get_telegram_user():
    init_data = request.headers.get(
        "X-Telegram-Init-Data", ""
    )
    return verify_telegram_data(init_data)


def authorized_user():
    user = get_telegram_user()

    if not user or not user.get("id"):
        return None

    database.register_user(
        user["id"],
        user.get("username")
    )

    return user


def admin_user():
    user = authorized_user()

    if not user:
        return None

    if not database.is_admin(user["id"]):
        return None

    return user


# -------------------------
# CATALOG DATABASE
# -------------------------

def init_catalog():
    with database.get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS case_skins (
                case_id INTEGER NOT NULL,
                skin_id INTEGER NOT NULL,
                weight INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (case_id, skin_id)
            );

            CREATE TABLE IF NOT EXISTS case_openings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                case_id INTEGER NOT NULL,
                skin_id INTEGER NOT NULL,
                price_paid INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS skin_sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                skin_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                amount_received INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        count = db.execute(
            "SELECT COUNT(*) AS total FROM cases"
        ).fetchone()["total"]

        # Начальный тестовый каталог.
        # Цены и веса выпадения можно будет изменить позднее.
        if count == 0:
            case_data = [
                ("Kilowatt Case", 100),
                ("Revolution Case", 250),
                ("Recoil Case", 400)
            ]

            for name, price in case_data:
                db.execute(
                    "INSERT INTO cases (name, price_dc) VALUES (?, ?)",
                    (name, price)
                )

        skin_data = [
            ("AK-47 | Inheritance", "Covert", 5000),
            ("AWP | Chrome Cannon", "Covert", 3500),
            ("USP-S | Jawbreaker", "Classified", 1800),

            ("AK-47 | Head Shot", "Covert", 4500),
            ("M4A4 | Temukau", "Covert", 4000),
            ("UMP-45 | Wild Child", "Classified", 1500),

            ("USP-S | Printstream", "Covert", 6000),
            ("AWP | Chromatic Aberration", "Covert", 3000),
            ("P250 | Visions", "Classified", 1200)
        ]

        for name, rarity, price in skin_data:
            db.execute("""
                INSERT INTO skins (name, rarity, price)
                SELECT ?, ?, ?
                WHERE NOT EXISTS (
                    SELECT 1 FROM skins WHERE name = ?
                )
            """, (name, rarity, price, name))

        case_rows = db.execute(
            "SELECT id, name FROM cases"
        ).fetchall()

        skin_rows = db.execute(
            "SELECT id, name FROM skins"
        ).fetchall()

        skin_ids = {
            row["name"]: row["id"]
            for row in skin_rows
        }

        case_ids = {
            row["name"]: row["id"]
            for row in case_rows
        }

        pools = {
            "Kilowatt Case": [
                ("AK-47 | Inheritance", 5),
                ("AWP | Chrome Cannon", 10),
                ("USP-S | Jawbreaker", 20)
            ],
            "Revolution Case": [
                ("AK-47 | Head Shot", 5),
                ("M4A4 | Temukau", 10),
                ("UMP-45 | Wild Child", 20)
            ],
            "Recoil Case": [
                ("USP-S | Printstream", 5),
                ("AWP | Chromatic Aberration", 10),
                ("P250 | Visions", 20)
            ]
        }

        for case_name, items in pools.items():
            case_id = case_ids.get(case_name)

            if not case_id:
                continue

            for skin_name, weight in items:
                skin_id = skin_ids.get(skin_name)

                if skin_id:
                    db.execute("""
                        INSERT OR IGNORE INTO case_skins
                        (case_id, skin_id, weight)
                        VALUES (?, ?, ?)
                    """, (case_id, skin_id, weight))


init_catalog()


# -------------------------
# BASIC
# -------------------------

@app.route("/")
def home():
    return "GUADON COIN SERVER IS ONLINE!"


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/api/balance")
def balance():
    user = authorized_user()

    if not user:
        return jsonify({
            "error": "Telegram authorization failed"
        }), 401

    user_id = user["id"]

    return jsonify({
        "user_id": user_id,
        "username": user.get("username"),
        "balance": database.get_balance(user_id),
        "currency": "DC"
    })


# -------------------------
# ADMIN
# -------------------------

@app.route("/api/admin/status")
def admin_status():
    user = authorized_user()

    if not user:
        return jsonify({"error": "Authorization failed"}), 401

    return jsonify({
        "is_admin": database.is_admin(user["id"])
    })


@app.route("/api/admin/give-dc", methods=["POST"])
def admin_give_dc():
    user = admin_user()

    if not user:
        return jsonify({"error": "Нет доступа"}), 403

    data = request.get_json(silent=True) or {}

    try:
        target_id = int(data.get("user_id"))
        amount = int(data.get("amount"))
    except (TypeError, ValueError):
        return jsonify({"error": "Неверные данные"}), 400

    if target_id <= 0 or amount <= 0:
        return jsonify({"error": "Неверная сумма или ID"}), 400

    database.register_user(target_id)

    database.change_balance(
        target_id,
        amount,
        "admin_give",
        user["id"]
    )

    database.log_admin(
        user["id"],
        "give_dc",
        target_id,
        str(amount)
    )

    return jsonify({
        "success": True,
        "message": f"Выдано {amount} DC",
        "balance": database.get_balance(target_id)
    })


@app.route("/api/admin/take-dc", methods=["POST"])
def admin_take_dc():
    user = admin_user()

    if not user:
        return jsonify({"error": "Нет доступа"}), 403

    data = request.get_json(silent=True) or {}

    try:
        target_id = int(data.get("user_id"))
        amount = int(data.get("amount"))
    except (TypeError, ValueError):
        return jsonify({"error": "Неверные данные"}), 400

    if target_id <= 0 or amount <= 0:
        return jsonify({"error": "Неверная сумма или ID"}), 400

    database.register_user(target_id)

    current_balance = database.get_balance(target_id)

    if amount > current_balance:
        return jsonify({
            "error": f"Недостаточно DC. Баланс: {current_balance}"
        }), 400

    database.change_balance(
        target_id,
        -amount,
        "admin_take",
        user["id"]
    )

    database.log_admin(
        user["id"],
        "take_dc",
        target_id,
        str(amount)
    )

    return jsonify({
        "success": True,
        "message": f"Снято {amount} DC",
        "balance": database.get_balance(target_id)
    })


@app.route("/api/admin/give-skin", methods=["POST"])
def admin_give_skin():
    user = admin_user()

    if not user:
        return jsonify({"error": "Нет доступа"}), 403

    data = request.get_json(silent=True) or {}

    try:
        target_id = int(data.get("user_id"))
        skin_id = int(data.get("skin_id"))
        quantity = int(data.get("quantity", 1))
    except (TypeError, ValueError):
        return jsonify({"error": "Неверные данные"}), 400

    if target_id <= 0 or skin_id <= 0 or quantity <= 0:
        return jsonify({"error": "Неверные данные"}), 400

    database.register_user(target_id)

    skin = database.get_skin(skin_id)

    if not skin:
        return jsonify({"error": "Скин не найден"}), 404

    database.add_inventory_skin(
        target_id,
        skin_id,
        quantity
    )

    database.log_admin(
        user["id"],
        "give_skin",
        target_id,
        f"skin={skin_id}, quantity={quantity}"
    )

    return jsonify({
        "success": True,
        "message": "Скин выдан",
        "skin": skin,
        "quantity": quantity
    })


# -------------------------
# CASES AND SKINS CATALOG
# -------------------------

@app.route("/api/cases")
def get_cases():
    user = authorized_user()

    if not user:
        return jsonify({"error": "Authorization failed"}), 401

    with database.get_db() as db:
        rows = db.execute("""
            SELECT id, name, price_dc
            FROM cases
            ORDER BY price_dc ASC
        """).fetchall()

    return jsonify({
        "cases": [dict(row) for row in rows]
    })


@app.route("/api/skins")
def get_skins():
    user = authorized_user()

    if not user:
        return jsonify({"error": "Authorization failed"}), 401

    return jsonify({
        "skins": database.get_all_skins()
    })


# -------------------------
# INVENTORY
# -------------------------

@app.route("/api/inventory")
def inventory():
    user = authorized_user()

    if not user:
        return jsonify({"error": "Authorization failed"}), 401

    return jsonify({
        "inventory": database.get_inventory(user["id"])
    })


# -------------------------
# OPEN CASE
# -------------------------

@app.route("/api/cases/open", methods=["POST"])
def open_case():
    user = authorized_user()

    if not user:
        return jsonify({"error": "Authorization failed"}), 401

    user_id = user["id"]

    data = request.get_json(silent=True) or {}

    try:
        case_id = int(data.get("case_id"))
    except (TypeError, ValueError):
        return jsonify({"error": "Неверный ID кейса"}), 400

    if case_id <= 0:
        return jsonify({"error": "Неверный ID кейса"}), 400

    try:
        with database.get_db() as db:
            db.execute("BEGIN IMMEDIATE")

            player = db.execute("""
                SELECT balance, is_banned
                FROM users
                WHERE telegram_id = ?
            """, (user_id,)).fetchone()

            if not player:
                return jsonify({"error": "Игрок не найден"}), 404

            if player["is_banned"]:
                return jsonify({"error": "Аккаунт заблокирован"}), 403

            case = db.execute("""
                SELECT id, name, price_dc
                FROM cases
                WHERE id = ?
            """, (case_id,)).fetchone()

            if not case:
                return jsonify({"error": "Кейс не найден"}), 404

            price = int(case["price_dc"])

            if price <= 0:
                return jsonify({"error": "Некорректная цена кейса"}), 400

            if player["balance"] < price:
                return jsonify({"error": "Недостаточно DC"}), 400

            pool = db.execute("""
                SELECT
                    skins.id,
                    skins.name,
                    skins.rarity,
                    skins.price,
                    case_skins.weight
                FROM case_skins
                JOIN skins ON skins.id = case_skins.skin_id
                WHERE case_skins.case_id = ?
                  AND case_skins.weight > 0
            """, (case_id,)).fetchall()

            if not pool:
                return jsonify({"error": "В кейсе пока нет скинов"}), 400

            weights = [int(row["weight"]) for row in pool]
            selected = random.choices(
                pool,
                weights=weights,
                k=1
            )[0]

            skin_id = selected["id"]

            updated = db.execute("""
                UPDATE users
                SET balance = balance - ?
                WHERE telegram_id = ? AND balance >= ?
            """, (price, user_id, price))

            if updated.rowcount != 1:
                return jsonify({"error": "Недостаточно DC"}), 400

            db.execute("""
                INSERT INTO inventory (user_id, skin_id, quantity)
                VALUES (?, ?, 1)
                ON CONFLICT(user_id, skin_id)
                DO UPDATE SET quantity = quantity + 1
            """, (user_id, skin_id))

            db.execute("""
                INSERT INTO transactions
                (user_id, amount, action, admin_id)
                VALUES (?, ?, 'case_open', NULL)
            """, (user_id, -price))

            db.execute("""
                INSERT INTO case_openings
                (user_id, case_id, skin_id, price_paid)
                VALUES (?, ?, ?, ?)
            """, (user_id, case_id, skin_id, price))

            new_balance = db.execute("""
                SELECT balance FROM users
                WHERE telegram_id = ?
            """, (user_id,)).fetchone()["balance"]

            result_skin = {
                "id": selected["id"],
                "name": selected["name"],
                "rarity": selected["rarity"],
                "price": selected["price"]
            }

            result_case = case["name"]

        return jsonify({
            "success": True,
            "case": result_case,
            "skin": result_skin,
            "balance": new_balance
        })

    except Exception as error:
        print("OPEN CASE ERROR:", type(error).__name__)
        return jsonify({"error": "Ошибка открытия кейса"}), 500


# -------------------------
# SELL SKIN
# -------------------------

@app.route("/api/skins/sell", methods=["POST"])
def sell_skin():
    user = authorized_user()

    if not user:
        return jsonify({"error": "Authorization failed"}), 401

    user_id = user["id"]

    data = request.get_json(silent=True) or {}

    try:
        skin_id = int(data.get("skin_id"))
        quantity = int(data.get("quantity", 1))
    except (TypeError, ValueError):
        return jsonify({"error": "Неверные данные"}), 400

    if skin_id <= 0 or quantity <= 0:
        return jsonify({"error": "Неверные данные"}), 400

    try:
        with database.get_db() as db:
            db.execute("BEGIN IMMEDIATE")

            player = db.execute("""
                SELECT is_banned FROM users
                WHERE telegram_id = ?
            """, (user_id,)).fetchone()

            if not player:
                return jsonify({"error": "Игрок не найден"}), 404

            if player["is_banned"]:
                return jsonify({"error": "Аккаунт заблокирован"}), 403

            skin = db.execute("""
                SELECT id, name, rarity, price
                FROM skins
                WHERE id = ?
            """, (skin_id,)).fetchone()

            if not skin:
                return jsonify({"error": "Скин не найден"}), 404

            item = db.execute("""
                SELECT quantity FROM inventory
                WHERE user_id = ? AND skin_id = ?
            """, (user_id, skin_id)).fetchone()

            if not item or item["quantity"] < quantity:
                return jsonify({
                    "error": "Недостаточно скинов в инвентаре"
                }), 400

            # Игрок получает 90% стоимости.
            unit_price = int(skin["price"])
            reward = (unit_price * 90 // 100) * quantity

            if reward <= 0:
                return jsonify({"error": "Цена скина слишком мала"}), 400

            if item["quantity"] == quantity:
                db.execute("""
                    DELETE FROM inventory
                    WHERE user_id = ? AND skin_id = ?
                """, (user_id, skin_id))
            else:
                db.execute("""
                    UPDATE inventory
                    SET quantity = quantity - ?
                    WHERE user_id = ? AND skin_id = ?
                """, (quantity, user_id, skin_id))

            db.execute("""
                UPDATE users
                SET balance = balance + ?
                WHERE telegram_id = ?
            """, (reward, user_id))

            db.execute("""
                INSERT INTO transactions
                (user_id, amount, action, admin_id)
                VALUES (?, ?, 'skin_sale', NULL)
            """, (user_id, reward))

            db.execute("""
                INSERT INTO skin_sales
                (user_id, skin_id, quantity, amount_received)
                VALUES (?, ?, ?, ?)
            """, (user_id, skin_id, quantity, reward))

            new_balance = db.execute("""
                SELECT balance FROM users
                WHERE telegram_id = ?
            """, (user_id,)).fetchone()["balance"]

        return jsonify({
            "success": True,
            "message": f"Продано: {skin['name']}",
            "quantity": quantity,
            "received": reward,
            "balance": new_balance
        })

    except Exception as error:
        print("SELL SKIN ERROR:", type(error).__name__)
        return jsonify({"error": "Ошибка продажи скина"}), 500


# -------------------------
# HISTORY
# -------------------------

@app.route("/api/history")
def history():
    user = authorized_user()

    if not user:
        return jsonify({"error": "Authorization failed"}), 401

    with database.get_db() as db:
        openings = db.execute("""
            SELECT
                case_openings.id,
                cases.name AS case_name,
                skins.name AS skin_name,
                skins.rarity,
                case_openings.price_paid,
                case_openings.created_at
            FROM case_openings
            JOIN cases ON cases.id = case_openings.case_id
            JOIN skins ON skins.id = case_openings.skin_id
            WHERE case_openings.user_id = ?
            ORDER BY case_openings.id DESC
            LIMIT 50
        """, (user["id"],)).fetchall()

        sales = db.execute("""
            SELECT
                skin_sales.id,
                skins.name AS skin_name,
                skin_sales.quantity,
                skin_sales.amount_received,
                skin_sales.created_at
            FROM skin_sales
            JOIN skins ON skins.id = skin_sales.skin_id
            WHERE skin_sales.user_id = ?
            ORDER BY skin_sales.id DESC
            LIMIT 50
        """, (user["id"],)).fetchall()

    return jsonify({
        "openings": [dict(row) for row in openings],
        "sales": [dict(row) for row in sales]
    })


# -------------------------
# START
# -------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
