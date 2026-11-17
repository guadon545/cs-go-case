
import os
import hmac
import hashlib
import json
import time
import base64
import random

from pathlib import Path
from urllib.parse import parse_qsl

from flask import Flask, request, jsonify
from flask_cors import CORS
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

import database
from upgrade import create_upgrade_blueprint
from clicker import create_clicker_blueprint
from craft import create_craft_blueprint


app = Flask(__name__)

CORS(
    app,
    origins=["https://guadon545.github.io"],
    allow_headers=["Content-Type", "X-Telegram-Init-Data"],
    methods=["GET", "POST", "OPTIONS"]
)

database.init_db()

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
ADMIN_IDS = os.getenv("ADMIN_IDS", "")

CATALOG_PATH = Path(__file__).resolve().parent / "catalog.json"

TELEGRAM_PUBLIC_KEY = bytes.fromhex(
    "e7bf03a2fa4602af4580703d88dda5bb"
    "59f32ed8b02a56c187fe7d34caed242d"
)

INVENTORY_LIMIT = 100


# ==========================================
# TELEGRAM AUTHORIZATION
# ==========================================

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
        print("AUTH ERROR:", type(error).__name__)
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


# ==========================================
# MODULES
# ==========================================

app.register_blueprint(
    create_upgrade_blueprint(authorized_user)
)

app.register_blueprint(
    create_clicker_blueprint(authorized_user)
)

app.register_blueprint(
    create_craft_blueprint(authorized_user)
)


# ==========================================
# ADMIN REGISTRATION
# ==========================================

for admin_id in ADMIN_IDS.split(","):
    if admin_id.strip().isdigit():
        database.add_admin(int(admin_id.strip()))


# ==========================================
# CATALOG DATABASE
# ==========================================

def init_catalog():
    if not CATALOG_PATH.exists():
        raise FileNotFoundError("catalog.json not found")

    with open(CATALOG_PATH, "r", encoding="utf-8") as file:
        catalog = json.load(file)

    cases_data = catalog.get("cases", [])

    if len(cases_data) != 9:
        raise ValueError("Catalog must contain exactly 9 cases")

    for case in cases_data:
        items = case.get("items", [])

        if not case.get("id") or not case.get("name"):
            raise ValueError("Invalid case data")

        if len(items) != 6:
            raise ValueError(
                f"Case {case['name']} must contain 6 items"
            )

        total_chance = sum(
            float(item["chance"])
            for item in items
        )

        if abs(total_chance - 100) > 0.000001:
            raise ValueError(
                f"Chances in {case['name']} must equal 100%"
            )

        for item in items:
            if (
                not item.get("name")
                or not item.get("rarity")
                or int(item["price_dc"]) <= 0
                or float(item["chance"]) <= 0
            ):
                raise ValueError(
                    f"Invalid item in {case['name']}"
                )

    with database.get_db() as db:

        db.execute("""
            CREATE TABLE IF NOT EXISTS case_skins (
                case_id BIGINT NOT NULL,
                skin_id BIGINT NOT NULL,
                weight INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (case_id, skin_id)
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS case_openings (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                user_id BIGINT NOT NULL,
                case_id BIGINT NOT NULL,
                skin_id BIGINT NOT NULL,
                price_paid BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS skin_sales (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                user_id BIGINT NOT NULL,
                skin_id BIGINT NOT NULL,
                quantity INTEGER NOT NULL,
                amount_received BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS catalog_cases (
                catalog_id TEXT PRIMARY KEY,
                case_id BIGINT NOT NULL UNIQUE
            )
        """)

        for case_data in cases_data:
            catalog_id = case_data["id"]

            mapping = db.execute("""
                SELECT case_id
                FROM catalog_cases
                WHERE catalog_id = %s
            """, (catalog_id,)).fetchone()

            if mapping:
                case_id = mapping["case_id"]

                db.execute("""
                    UPDATE cases
                    SET name = %s, price_dc = %s
                    WHERE id = %s
                """, (
                    case_data["name"],
                    int(case_data["price_dc"]),
                    case_id
                ))

            else:
                case_row = db.execute("""
                    INSERT INTO cases (name, price_dc)
                    VALUES (%s, %s)
                    RETURNING id
                """, (
                    case_data["name"],
                    int(case_data["price_dc"])
                )).fetchone()

                case_id = case_row["id"]

                db.execute("""
                    INSERT INTO catalog_cases
                    (catalog_id, case_id)
                    VALUES (%s, %s)
                """, (catalog_id, case_id))

            db.execute("""
                DELETE FROM case_skins
                WHERE case_id = %s
            """, (case_id,))

            for item in case_data["items"]:
                image_url = item.get("image_url")

                skin = db.execute("""
                    SELECT id
                    FROM skins
                    WHERE name = %s
                """, (item["name"],)).fetchone()

                if skin:
                    skin_id = skin["id"]

                    db.execute("""
                        UPDATE skins
                        SET rarity = %s,
                            price = %s,
                            image_url = COALESCE(%s, image_url)
                        WHERE id = %s
                    """, (
                        item["rarity"],
                        int(item["price_dc"]),
                        image_url,
                        skin_id
                    ))

                else:
                    skin_row = db.execute("""
                        INSERT INTO skins
                        (name, rarity, price, image_url)
                        VALUES (%s, %s, %s, %s)
                        RETURNING id
                    """, (
                        item["name"],
                        item["rarity"],
                        int(item["price_dc"]),
                        image_url
                    )).fetchone()

                    skin_id = skin_row["id"]

                db.execute("""
                    INSERT INTO case_skins
                    (case_id, skin_id, weight)
                    VALUES (%s, %s, %s)
                """, (
                    case_id,
                    skin_id,
                    int(round(float(item["chance"]) * 100))
                ))

    print("CATALOG LOADED:", len(cases_data), "cases")


init_catalog()


# ==========================================
# BASIC
# ==========================================

@app.route("/")
def home():
    return "GUADON COIN SERVER IS ONLINE!"


@app.route("/health")
def health():
    return jsonify({
        "status": "ok",
        "catalog": "loaded",
        "inventory_limit": INVENTORY_LIMIT
    })


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


# ==========================================
# PROFILE
# ==========================================

@app.route("/api/profile")
def profile():
    user = authorized_user()

    if not user:
        return jsonify({
            "error": "Telegram authorization failed"
        }), 401

    user_id = user["id"]

    try:
        stats = database.get_profile_stats(user_id)

        with database.get_db() as db:
            opened_cases = db.execute("""
                SELECT COUNT(*) AS total
                FROM case_openings
                WHERE user_id = %s
            """, (user_id,)).fetchone()["total"]

            best_item = db.execute("""
                SELECT name, price, source, created_at
                FROM (
                    SELECT
                        id,
                        skin_name AS name,
                        skin_price AS price,
                        source,
                        created_at
                    FROM item_history
                    WHERE user_id = %s

                    UNION ALL

                    SELECT
                        co.id,
                        s.name,
                        s.price,
                        'case' AS source,
                        co.created_at
                    FROM case_openings co
                    JOIN skins s ON s.id = co.skin_id
                    WHERE co.user_id = %s
                ) AS history
                ORDER BY price DESC, id ASC
                LIMIT 1
            """, (user_id, user_id)).fetchone()

        stats["balance"] = database.get_balance(user_id)
        stats["opened_cases"] = opened_cases
        stats["best_item"] = (
            dict(best_item) if best_item else None
        )

        return jsonify({
            "success": True,
            "profile": stats
        })

    except Exception as error:
        print("PROFILE ERROR:", type(error).__name__)
        return jsonify({
            "error": "Ошибка загрузки профиля"
        }), 500


# ==========================================
# ADMIN
# ==========================================

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
        target_id, amount, "admin_give", user["id"]
    )

    database.log_admin(
        user["id"], "give_dc", target_id, str(amount)
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
        target_id, -amount, "admin_take", user["id"]
    )

    database.log_admin(
        user["id"], "take_dc", target_id, str(amount)
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

    try:
        database.add_inventory_skin(
            target_id, skin_id, quantity
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

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
        "quantity": quantity,
        "inventory": database.get_inventory_space(target_id)
    })


# ==========================================
# CASES AND SKINS
# ==========================================

@app.route("/api/cases")
def get_cases():
    user = authorized_user()

    if not user:
        return jsonify({"error": "Authorization failed"}), 401

    with database.get_db() as db:
        cases = db.execute("""
            SELECT
                cases.id,
                catalog_cases.catalog_id,
                cases.name,
                cases.price_dc
            FROM cases
            JOIN catalog_cases
                ON catalog_cases.case_id = cases.id
            ORDER BY cases.price_dc ASC
        """).fetchall()

        result = []

        for case in cases:
            items = db.execute("""
                SELECT
                    skins.id,
                    skins.name,
                    skins.rarity,
                    skins.price,
                    skins.image_url,
                    case_skins.weight
                FROM case_skins
                JOIN skins
                    ON skins.id = case_skins.skin_id
                WHERE case_skins.case_id = %s
                ORDER BY case_skins.weight DESC
            """, (case["id"],)).fetchall()

            total_weight = sum(
                int(item["weight"]) for item in items
            )

            result.append({
                "id": case["id"],
                "catalog_id": case["catalog_id"],
                "name": case["name"],
                "price_dc": case["price_dc"],
                "items": [
                    {
                        "id": item["id"],
                        "name": item["name"],
                        "rarity": item["rarity"],
                        "price": item["price"],
                        "image_url": item["image_url"],
                        "chance": round(
                            int(item["weight"]) / total_weight * 100, 2
                        ) if total_weight else 0
                    }
                    for item in items
                ]
            })

    return jsonify({"cases": result})


@app.route("/api/cases/<int:case_id>")
def get_case_details(case_id):
    user = authorized_user()

    if not user:
        return jsonify({"error": "Authorization failed"}), 401

    with database.get_db() as db:
        case = db.execute("""
            SELECT
                cases.id,
                catalog_cases.catalog_id,
                cases.name,
                cases.price_dc
            FROM cases
            JOIN catalog_cases
                ON catalog_cases.case_id = cases.id
            WHERE cases.id = %s
        """, (case_id,)).fetchone()

        if not case:
            return jsonify({"error": "Кейс не найден"}), 404

        items = db.execute("""
            SELECT
                skins.id,
                skins.name,
                skins.rarity,
                skins.price,
                skins.image_url,
                case_skins.weight
            FROM case_skins
            JOIN skins
                ON skins.id = case_skins.skin_id
            WHERE case_skins.case_id = %s
        """, (case_id,)).fetchall()

        total_weight = sum(
            int(item["weight"]) for item in items
        )

        return jsonify({
            "case": {
                "id": case["id"],
                "catalog_id": case["catalog_id"],
                "name": case["name"],
                "price_dc": case["price_dc"],
                "items": [
                    {
                        "id": item["id"],
                        "name": item["name"],
                        "rarity": item["rarity"],
                        "price": item["price"],
                        "image_url": item["image_url"],
                        "chance": round(
                            int(item["weight"]) / total_weight * 100, 2
                        ) if total_weight else 0
                    }
                    for item in items
                ]
            }
        })


@app.route("/api/skins")
def get_skins():
    user = authorized_user()

    if not user:
        return jsonify({"error": "Authorization failed"}), 401

    return jsonify({
        "skins": database.get_all_skins()
    })


# ==========================================
# INVENTORY
# ==========================================

@app.route("/api/inventory")
def inventory():
    user = authorized_user()

    if not user:
        return jsonify({"error": "Authorization failed"}), 401

    user_id = user["id"]

    return jsonify({
        "inventory": database.get_inventory(user_id),
        "capacity": database.get_inventory_space(user_id)
    })


# ==========================================
# OPEN CASES: 1 TO 5
# ==========================================

@app.route("/api/cases/open", methods=["POST"])
def open_case():
    user = authorized_user()

    if not user:
        return jsonify({"error": "Authorization failed"}), 401

    user_id = int(user["id"])
    data = request.get_json(silent=True) or {}

    try:
        case_id = int(data.get("case_id"))
        count = int(data.get("count", 1))
    except (TypeError, ValueError):
        return jsonify({"error": "Неверные данные"}), 400

    if case_id <= 0:
        return jsonify({"error": "Неверный ID кейса"}), 400

    if count < 1 or count > 5:
        return jsonify({
            "error": "Можно открыть от 1 до 5 кейсов"
        }), 400

    try:
        with database.get_db() as db:

            player = db.execute("""
                SELECT balance, is_banned
                FROM users
                WHERE telegram_id = %s
                FOR UPDATE
            """, (user_id,)).fetchone()

            if not player:
                return jsonify({"error": "Игрок не найден"}), 404

            if player["is_banned"]:
                return jsonify({"error": "Аккаунт заблокирован"}), 403

            # Проверяем вместимость до списания баланса.
            inventory_row = db.execute("""
                SELECT COUNT(*) AS total
                FROM inventory
                WHERE user_id = %s
            """, (user_id,)).fetchone()

            inventory_used = int(inventory_row["total"])
            inventory_remaining = INVENTORY_LIMIT - inventory_used

            if inventory_remaining < count:
                return jsonify({
                    "error": (
                        "Недостаточно места в инвентаре. "
                        f"Свободно: {max(0, inventory_remaining)} "
                        f"из {INVENTORY_LIMIT}"
                    ),
                    "inventory_used": inventory_used,
                    "inventory_limit": INVENTORY_LIMIT,
                    "inventory_remaining": max(0, inventory_remaining)
                }), 400

            case = db.execute("""
                SELECT
                    cases.id,
                    cases.name,
                    cases.price_dc
                FROM cases
                JOIN catalog_cases
                    ON catalog_cases.case_id = cases.id
                WHERE cases.id = %s
            """, (case_id,)).fetchone()

            if not case:
                return jsonify({"error": "Кейс не найден"}), 404

            price = int(case["price_dc"])
            total_price = price * count

            if price <= 0:
                return jsonify({
                    "error": "Некорректная цена кейса"
                }), 400

            if player["balance"] < total_price:
                return jsonify({
                    "error": "Недостаточно DC",
                    "required": total_price,
                    "balance": player["balance"]
                }), 400

            pool = db.execute("""
                SELECT
                    skins.id,
                    skins.name,
                    skins.rarity,
                    skins.price,
                    skins.image_url,
                    case_skins.weight
                FROM case_skins
                JOIN skins
                    ON skins.id = case_skins.skin_id
                WHERE case_skins.case_id = %s
                  AND case_skins.weight > 0
            """, (case_id,)).fetchall()

            if not pool:
                return jsonify({
                    "error": "В кейсе пока нет скинов"
                }), 400

            selected_items = random.choices(
                pool,
                weights=[
                    int(item["weight"]) for item in pool
                ],
                k=count
            )

            updated = db.execute("""
                UPDATE users
                SET balance = balance - %s
                WHERE telegram_id = %s
                  AND balance >= %s
            """, (total_price, user_id, total_price))

            if updated.rowcount != 1:
                return jsonify({
                    "error": "Недостаточно DC"
                }), 400

            results = []

            for selected in selected_items:
                skin_id = selected["id"]

                # Каждая копия получает собственную запись.
                inventory_item = db.execute("""
                    INSERT INTO inventory
                    (user_id, skin_id, quantity)
                    VALUES (%s, %s, 1)
                    RETURNING id
                """, (user_id, skin_id)).fetchone()

                db.execute("""
                    INSERT INTO case_openings
                    (user_id, case_id, skin_id, price_paid)
                    VALUES (%s, %s, %s, %s)
                """, (
                    user_id,
                    case_id,
                    skin_id,
                    price
                ))

                db.execute("""
                    INSERT INTO item_history
                    (user_id, skin_id, skin_name, skin_price, source)
                    VALUES (%s, %s, %s, %s, %s)
                """, (
                    user_id,
                    skin_id,
                    selected["name"],
                    selected["price"],
                    "case"
                ))

                results.append({
                    "inventory_id": inventory_item["id"],
                    "id": skin_id,
                    "name": selected["name"],
                    "rarity": selected["rarity"],
                    "price": selected["price"],
                    "image_url": selected["image_url"],
                    "sell_price": int(selected["price"]) * 90 // 100
                })

            db.execute("""
                INSERT INTO profile_stats (user_id)
                VALUES (%s)
                ON CONFLICT (user_id) DO NOTHING
            """, (user_id,))

            db.execute("""
                UPDATE profile_stats
                SET opened_cases = opened_cases + %s
                WHERE user_id = %s
            """, (count, user_id))

            db.execute("""
                INSERT INTO transactions
                (user_id, amount, action, admin_id)
                VALUES (%s, %s, 'case_open', NULL)
            """, (user_id, -total_price))

            new_balance = db.execute("""
                SELECT balance
                FROM users
                WHERE telegram_id = %s
            """, (user_id,)).fetchone()["balance"]

        return jsonify({
            "success": True,
            "case": case["name"],
            "count": count,
            "total_price": total_price,
            "skins": results,
            "skin": results[0],
            "balance": new_balance,
            "inventory": {
                "used": inventory_used + count,
                "limit": INVENTORY_LIMIT,
                "remaining": inventory_remaining - count
            }
        })

    except Exception as error:
        print("OPEN CASE ERROR:", type(error).__name__, str(error))
        return jsonify({
            "error": "Ошибка открытия кейса"
        }), 500


# ==========================================
# SELL ONE INVENTORY ITEM
# ==========================================

@app.route("/api/skins/sell", methods=["POST"])
def sell_skin():
    user = authorized_user()

    if not user:
        return jsonify({"error": "Authorization failed"}), 401

    user_id = int(user["id"])
    data = request.get_json(silent=True) or {}

    try:
        inventory_id = data.get("inventory_id")

        # Временная совместимость со старым интерфейсом:
        # если он отправил skin_id, продаём только одну копию.
        skin_id = data.get("skin_id")

        if inventory_id is not None:
            inventory_id = int(inventory_id)
            if inventory_id <= 0:
                raise ValueError()
        elif skin_id is not None:
            skin_id = int(skin_id)
            if skin_id <= 0:
                raise ValueError()
        else:
            raise ValueError()

    except (TypeError, ValueError):
        return jsonify({"error": "Неверные данные"}), 400

    try:
        with database.get_db() as db:

            player = db.execute("""
                SELECT is_banned
                FROM users
                WHERE telegram_id = %s
                FOR UPDATE
            """, (user_id,)).fetchone()

            if not player:
                return jsonify({"error": "Игрок не найден"}), 404

            if player["is_banned"]:
                return jsonify({"error": "Аккаунт заблокирован"}), 403

            if inventory_id is not None:
                item = db.execute("""
                    SELECT
                        inventory.id AS inventory_id,
                        skins.id AS skin_id,
                        skins.name,
                        skins.rarity,
                        skins.price
                    FROM inventory
                    JOIN skins ON skins.id = inventory.skin_id
                    WHERE inventory.id = %s
                      AND inventory.user_id = %s
                    FOR UPDATE OF inventory
                """, (inventory_id, user_id)).fetchone()
            else:
                item = db.execute("""
                    SELECT
                        inventory.id AS inventory_id,
                        skins.id AS skin_id,
                        skins.name,
                        skins.rarity,
                        skins.price
                    FROM inventory
                    JOIN skins ON skins.id = inventory.skin_id
                    WHERE inventory.user_id = %s
                      AND inventory.skin_id = %s
                    ORDER BY inventory.acquired_at ASC, inventory.id ASC
                    LIMIT 1
                    FOR UPDATE OF inventory
                """, (user_id, skin_id)).fetchone()

            if not item:
                return jsonify({
                    "error": "Предмет не найден в инвентаре"
                }), 404

            unit_price = int(item["price"])
            reward = unit_price * 90 // 100

            if reward <= 0:
                return jsonify({
                    "error": "Цена скина слишком мала"
                }), 400

            # Удаляем только одну конкретную запись.
            db.execute("""
                DELETE FROM inventory
                WHERE id = %s AND user_id = %s
            """, (item["inventory_id"], user_id))

            db.execute("""
                UPDATE users
                SET balance = balance + %s
                WHERE telegram_id = %s
            """, (reward, user_id))

            db.execute("""
                INSERT INTO transactions
                (user_id, amount, action, admin_id)
                VALUES (%s, %s, 'skin_sale', NULL)
            """, (user_id, reward))

            db.execute("""
                INSERT INTO skin_sales
                (user_id, skin_id, quantity, amount_received)
                VALUES (%s, %s, 1, %s)
            """, (
                user_id,
                item["skin_id"],
                reward
            ))

            new_balance = db.execute("""
                SELECT balance
                FROM users
                WHERE telegram_id = %s
            """, (user_id,)).fetchone()["balance"]

            remaining = db.execute("""
                SELECT COUNT(*) AS total
                FROM inventory
                WHERE user_id = %s
            """, (user_id,)).fetchone()["total"]

        return jsonify({
            "success": True,
            "message": f"Продано: {item['name']}",
            "inventory_id": item["inventory_id"],
            "quantity": 1,
            "received": reward,
            "balance": new_balance,
            "inventory": {
                "used": int(remaining),
                "limit": INVENTORY_LIMIT,
                "remaining": INVENTORY_LIMIT - int(remaining)
            }
        })

    except Exception as error:
        print("SELL SKIN ERROR:", type(error).__name__, str(error))
        return jsonify({
            "error": "Ошибка продажи скина"
        }), 500


# ==========================================
# HISTORY
# ==========================================

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
            WHERE case_openings.user_id = %s
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
            WHERE skin_sales.user_id = %s
            ORDER BY skin_sales.id DESC
            LIMIT 50
        """, (user["id"],)).fetchall()

    return jsonify({
        "openings": [dict(row) for row in openings],
        "sales": [dict(row) for row in sales]
    })


# ==========================================
# START
# ==========================================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
