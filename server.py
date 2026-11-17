
import os
import json
import hmac
import hashlib
import secrets
import uuid

from pathlib import Path
from urllib.parse import parse_qsl

from flask import Flask, request, jsonify
from flask_cors import CORS

import database
import upgrade
import craft


BASE_DIR = Path(__file__).resolve().parent
CATALOG_PATH = BASE_DIR / "catalog.json"

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
ADMIN_IDS = {
    int(value.strip())
    for value in os.getenv("ADMIN_IDS", "").split(",")
    if value.strip().isdigit()
}

BACKGROUND_NAMES = {
    "normal": "Обычный",
    "gold": "Gold",
    "onyx_black": "Onyx Black",
    "black": "Black"
}

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})


# -------------------------
# TELEGRAM AUTHORIZATION
# -------------------------

def verify_telegram_data(init_data):
    if not init_data or not BOT_TOKEN:
        return None

    try:
        parsed = dict(parse_qsl(init_data, keep_blank_values=True))
        received_hash = parsed.pop("hash", None)

        if not received_hash:
            return None

        data_check_string = "\n".join(
            f"{key}={value}"
            for key, value in sorted(parsed.items())
        )

        secret_key = hmac.new(
            b"WebAppData",
            BOT_TOKEN.encode(),
            hashlib.sha256
        ).digest()

        calculated_hash = hmac.new(
            secret_key,
            data_check_string.encode(),
            hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(calculated_hash, received_hash):
            return None

        user_data = json.loads(parsed.get("user", "{}"))

        if not user_data.get("id"):
            return None

        return user_data

    except Exception:
        return None


def authorized_user():
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    return verify_telegram_data(init_data)


def require_user():
    user = authorized_user()

    if not user:
        return None, (jsonify({
            "success": False,
            "error": "Ошибка авторизации Telegram"
        }), 401)

    player = database.register_user(
        user["id"],
        user.get("username")
    )

    if player.get("is_banned"):
        return None, (jsonify({
            "success": False,
            "error": "Аккаунт заблокирован"
        }), 403)

    return user, None


def require_admin():
    user, error = require_user()

    if error:
        return None, error

    if (
        int(user["id"]) not in ADMIN_IDS
        and not database.is_admin(user["id"])
    ):
        return None, (jsonify({
            "success": False,
            "error": "Нет доступа"
        }), 403)

    return user, None


# -------------------------
# GAME MODULE AUTHORIZATION
# -------------------------

def authorized_game_user():
    user, error = require_user()

    if error:
        return None

    return {
        "telegram_id": int(user["id"])
    }


# -------------------------
# CATALOG
# -------------------------

def weighted_choice(items, weight_key):
    weights = [
        max(0, int(round(float(item[weight_key]) * 10000)))
        for item in items
    ]

    total = sum(weights)

    if total <= 0:
        raise ValueError("Некорректные вероятности")

    roll = secrets.randbelow(total)
    current = 0

    for item, weight in zip(items, weights):
        current += weight

        if roll < current:
            return item

    return items[-1]


def load_catalog():
    if not CATALOG_PATH.exists():
        raise RuntimeError("Не найден catalog.json")

    with open(CATALOG_PATH, "r", encoding="utf-8") as file:
        catalog = json.load(file)

    if catalog.get("version") != 2:
        raise RuntimeError("Неподдерживаемая версия catalog.json")

    if len(catalog.get("cases", [])) != 10:
        raise RuntimeError("В каталоге должно быть ровно 10 кейсов")

    for case in catalog["cases"]:
        if not 7 <= len(case.get("items", [])) <= 13:
            raise RuntimeError(
                f"В кейсе {case['id']} должно быть от 7 до 13 NFT"
            )

        item_total = sum(
            float(item["chance"])
            for item in case["items"]
        )

        background_total = sum(
            float(item["chance"])
            for item in case["background_chances"]
        )

        if abs(item_total - 100) > 0.001:
            raise RuntimeError(
                f"Вероятности NFT в кейсе {case['id']} не равны 100%"
            )

        if abs(background_total - 100) > 0.001:
            raise RuntimeError(
                f"Вероятности фонов в кейсе {case['id']} не равны 100%"
            )

    return catalog


def init_catalog():
    catalog = load_catalog()

    with database.get_db() as db:
        for sort_order, case in enumerate(catalog["cases"]):
            db.execute("""
                INSERT INTO nft_cases (
                    code, name, price, image_url, sort_order, is_active
                )
                VALUES (%s, %s, %s, %s, %s, TRUE)
                ON CONFLICT (code)
                DO UPDATE SET
                    name = EXCLUDED.name,
                    price = EXCLUDED.price,
                    image_url = EXCLUDED.image_url,
                    sort_order = EXCLUDED.sort_order,
                    is_active = TRUE
            """, (
                case["id"],
                case["name"],
                case["price_g"],
                case.get("image_url"),
                sort_order
            ))

            case_row = db.execute("""
                SELECT id
                FROM nft_cases
                WHERE code = %s
            """, (case["id"],)).fetchone()

            case_db_id = case_row["id"]

            db.execute("""
                DELETE FROM nft_case_items
                WHERE case_id = %s
            """, (case_db_id,))

            db.execute("""
                DELETE FROM nft_case_backgrounds
                WHERE case_id = %s
            """, (case_db_id,))

            for item in case["items"]:
                db.execute("""
                    INSERT INTO nft_catalog (
                        code, name, rarity, base_price, image_url, is_active
                    )
                    VALUES (%s, %s, %s, %s, %s, TRUE)
                    ON CONFLICT (code)
                    DO UPDATE SET
                        name = EXCLUDED.name,
                        rarity = EXCLUDED.rarity,
                        base_price = EXCLUDED.base_price,
                        image_url = EXCLUDED.image_url,
                        is_active = TRUE
                """, (
                    item["code"],
                    item["name"],
                    item["rarity"],
                    item["base_price"],
                    item.get("image_url")
                ))

                nft = db.execute("""
                    SELECT id
                    FROM nft_catalog
                    WHERE code = %s
                """, (item["code"],)).fetchone()

                db.execute("""
                    INSERT INTO nft_case_items (
                        case_id, nft_id, chance
                    )
                    VALUES (%s, %s, %s)
                """, (
                    case_db_id,
                    nft["id"],
                    item["chance"]
                ))

            for background in case["background_chances"]:
                background_id = background["background"]

                db.execute("""
                    INSERT INTO nft_case_backgrounds (
                        case_id, background, multiplier, chance
                    )
                    VALUES (%s, %s, %s, %s)
                """, (
                    case_db_id,
                    background_id,
                    {
                        "normal": 1,
                        "gold": 3,
                        "onyx_black": 5,
                        "black": 10
                    }[background_id],
                    background["chance"]
                ))


# -------------------------
# BASIC ROUTES
# -------------------------

@app.route("/")
def index():
    return jsonify({
        "name": "NFT CASE",
        "status": "online"
    })


@app.route("/health")
def health():
    return jsonify({
        "success": True,
        "status": "online"
    })


@app.route("/api/balance")
def get_balance():
    user, error = require_user()

    if error:
        return error

    return jsonify({
        "success": True,
        "balance": database.get_balance(user["id"]),
        "currency": "G"
    })


# -------------------------
# PROFILE
# -------------------------

@app.route("/api/profile")
def get_profile():
    user, error = require_user()

    if error:
        return error

    with database.get_db() as db:
        player = db.execute("""
            SELECT
                u.telegram_id,
                u.game_id,
                u.username,
                u.balance,
                u.created_at,
                u.sound_enabled,
                s.cases_opened,
                s.upgrades_played,
                s.upgrades_won,
                s.crafts_completed,
                s.nft_sold,
                s.total_spent,
                s.total_earned
            FROM users u
            LEFT JOIN nft_player_stats s
                ON s.user_id = u.telegram_id
            WHERE u.telegram_id = %s
        """, (int(user["id"]),)).fetchone()

        inventory_count = db.execute("""
            SELECT COUNT(*) AS total
            FROM nft_inventory
            WHERE user_id = %s
        """, (int(user["id"]),)).fetchone()

        best_item = db.execute("""
            SELECT
                n.name,
                i.final_price,
                i.background,
                n.image_url
            FROM nft_inventory i
            JOIN nft_catalog n ON n.id = i.nft_id
            WHERE i.user_id = %s
            ORDER BY i.final_price DESC
            LIMIT 1
        """, (int(user["id"]),)).fetchone()

    return jsonify({
        "success": True,
        "profile": {
            "game_id": f"#{player['game_id']}",
            "username": player["username"],
            "first_name": user.get("first_name"),
            "balance": player["balance"],
            "created_at": player["created_at"],
            "sound_enabled": player["sound_enabled"],
            "inventory_count": inventory_count["total"],
            "stats": {
                "cases_opened": player["cases_opened"] or 0,
                "upgrades_played": player["upgrades_played"] or 0,
                "upgrades_won": player["upgrades_won"] or 0,
                "crafts_completed": player["crafts_completed"] or 0,
                "nft_sold": player["nft_sold"] or 0,
                "total_spent": player["total_spent"] or 0,
                "total_earned": player["total_earned"] or 0
            },
            "best_item": dict(best_item) if best_item else None
        }
    })


@app.route("/api/profile/settings", methods=["POST"])
def update_profile_settings():
    user, error = require_user()

    if error:
        return error

    data = request.get_json(silent=True) or {}
    sound_enabled = data.get("sound_enabled")

    if not isinstance(sound_enabled, bool):
        return jsonify({"error": "Неверное значение настройки"}), 400

    with database.get_db() as db:
        db.execute("""
            UPDATE users
            SET sound_enabled = %s
            WHERE telegram_id = %s
        """, (sound_enabled, int(user["id"])))

    return jsonify({
        "success": True,
        "sound_enabled": sound_enabled
    })


# -------------------------
# CASES
# -------------------------

@app.route("/api/cases")
def get_cases():
    user, error = require_user()

    if error:
        return error

    with database.get_db() as db:
        rows = db.execute("""
            SELECT
                c.code,
                c.name,
                c.price,
                c.image_url,
                COUNT(ci.id) AS item_count
            FROM nft_cases c
            LEFT JOIN nft_case_items ci ON ci.case_id = c.id
            WHERE c.is_active = TRUE
            GROUP BY c.id
            ORDER BY c.sort_order
        """).fetchall()

    return jsonify({
        "success": True,
        "currency": "G",
        "cases": [dict(row) for row in rows]
    })


@app.route("/api/cases/<case_code>")
def get_case(case_code):
    user, error = require_user()

    if error:
        return error

    with database.get_db() as db:
        case = db.execute("""
            SELECT *
            FROM nft_cases
            WHERE code = %s AND is_active = TRUE
        """, (case_code,)).fetchone()

        if not case:
            return jsonify({"error": "Кейс не найден"}), 404

        items = db.execute("""
            SELECT
                n.code,
                n.name,
                n.rarity,
                n.base_price,
                n.image_url,
                ci.chance
            FROM nft_case_items ci
            JOIN nft_catalog n ON n.id = ci.nft_id
            WHERE ci.case_id = %s
            ORDER BY n.base_price
        """, (case["id"],)).fetchall()

        backgrounds = db.execute("""
            SELECT background, multiplier, chance
            FROM nft_case_backgrounds
            WHERE case_id = %s
            ORDER BY multiplier
        """, (case["id"],)).fetchall()

    return jsonify({
        "success": True,
        "case": dict(case),
        "items": [dict(item) for item in items],
        "backgrounds": [dict(item) for item in backgrounds]
    })


@app.route("/api/cases/open", methods=["POST"])
def open_case():
    user, error = require_user()

    if error:
        return error

    data = request.get_json(silent=True) or {}
    case_code = data.get("case_code") or data.get("case_id")
    quantity = data.get("quantity", 1)

    try:
        quantity = int(quantity)
    except (TypeError, ValueError):
        return jsonify({"error": "Неверное количество"}), 400

    if quantity < 1 or quantity > 5:
        return jsonify({"error": "Можно открыть от 1 до 5 кейсов"}), 400

    if not isinstance(case_code, str):
        return jsonify({"error": "Не указан кейс"}), 400

    user_id = int(user["id"])
    batch_id = str(uuid.uuid4())

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

            case = db.execute("""
                SELECT *
                FROM nft_cases
                WHERE code = %s AND is_active = TRUE
            """, (case_code,)).fetchone()

            if not case:
                return jsonify({"error": "Кейс не найден"}), 404

            total_price = int(case["price"]) * quantity

            if int(player["balance"]) < total_price:
                return jsonify({"error": "Недостаточно G"}), 400

            current_count = db.execute("""
                SELECT
                    (SELECT COUNT(*) FROM nft_inventory
                     WHERE user_id = %s)
                    +
                    (SELECT COUNT(*) FROM nft_pending_rewards
                     WHERE user_id = %s AND status = 'pending')
                    AS total
            """, (user_id, user_id)).fetchone()["total"]

            if int(current_count) + quantity > database.INVENTORY_LIMIT:
                return jsonify({
                    "error": "Недостаточно места в инвентаре"
                }), 400

            items = db.execute("""
                SELECT
                    n.id AS nft_id,
                    n.code,
                    n.name,
                    n.rarity,
                    n.base_price,
                    n.image_url,
                    ci.chance
                FROM nft_case_items ci
                JOIN nft_catalog n ON n.id = ci.nft_id
                WHERE ci.case_id = %s AND n.is_active = TRUE
            """, (case["id"],)).fetchall()

            backgrounds = db.execute("""
                SELECT background, multiplier, chance
                FROM nft_case_backgrounds
                WHERE case_id = %s
            """, (case["id"],)).fetchall()

            if not items or not backgrounds:
                return jsonify({"error": "У кейса нет содержимого"}), 500

            new_balance = int(player["balance"]) - total_price

            db.execute("""
                UPDATE users
                SET balance = %s
                WHERE telegram_id = %s
            """, (new_balance, user_id))

            db.execute("""
                INSERT INTO nft_g_transactions (
                    user_id, amount, balance_after, action, description
                )
                VALUES (%s, %s, %s, %s, %s)
            """, (
                user_id,
                -total_price,
                new_balance,
                "case_open",
                f"Открытие кейса {case_code} x{quantity}"
            ))

            rewards = []

            for _ in range(quantity):
                selected = weighted_choice(items, "chance")
                background = weighted_choice(backgrounds, "chance")

                multiplier = float(background["multiplier"])
                final_price = int(
                    round(int(selected["base_price"]) * multiplier)
                )

                reward = db.execute("""
                    INSERT INTO nft_pending_rewards (
                        user_id,
                        nft_id,
                        background,
                        background_multiplier,
                        final_price,
                        case_code,
                        batch_id
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (
                    user_id,
                    selected["nft_id"],
                    background["background"],
                    multiplier,
                    final_price,
                    case_code,
                    batch_id
                )).fetchone()

                rewards.append({
                    "reward_id": reward["id"],
                    "code": selected["code"],
                    "name": selected["name"],
                    "rarity": selected["rarity"],
                    "image_url": selected["image_url"],
                    "base_price": selected["base_price"],
                    "background": background["background"],
                    "background_name": BACKGROUND_NAMES.get(
                        background["background"],
                        background["background"]
                    ),
                    "multiplier": multiplier,
                    "price": final_price
                })

            db.execute("""
                INSERT INTO nft_case_history (
                    user_id, case_code, quantity, total_price, batch_id
                )
                VALUES (%s, %s, %s, %s, %s)
            """, (
                user_id,
                case_code,
                quantity,
                total_price,
                batch_id
            ))

            db.execute("""
                UPDATE nft_player_stats
                SET cases_opened = cases_opened + %s,
                    total_spent = total_spent + %s
                WHERE user_id = %s
            """, (quantity, total_price, user_id))

        return jsonify({
            "success": True,
            "batch_id": batch_id,
            "balance": new_balance,
            "quantity": quantity,
            "total_price": total_price,
            "rewards": rewards
        })

    except Exception as exc:
        print("OPEN CASE ERROR:", type(exc).__name__, str(exc))
        return jsonify({"error": "Ошибка открытия кейса"}), 500


# -------------------------
# PENDING REWARDS
# -------------------------

@app.route("/api/rewards/claim", methods=["POST"])
def claim_rewards():
    user, error = require_user()

    if error:
        return error

    data = request.get_json(silent=True) or {}
    batch_id = data.get("batch_id")

    if not batch_id:
        return jsonify({"error": "Не указан batch_id"}), 400

    user_id = int(user["id"])

    try:
        uuid.UUID(str(batch_id))

        with database.get_db() as db:
            db.execute("""
                SELECT telegram_id
                FROM users
                WHERE telegram_id = %s
                FOR UPDATE
            """, (user_id,))

            rewards = db.execute("""
                SELECT *
                FROM nft_pending_rewards
                WHERE user_id = %s
                  AND batch_id = %s
                  AND status = 'pending'
                FOR UPDATE
            """, (user_id, batch_id)).fetchall()

            if not rewards:
                return jsonify({
                    "error": "Награды уже получены или не найдены"
                }), 404

            count = db.execute("""
                SELECT COUNT(*) AS total
                FROM nft_inventory
                WHERE user_id = %s
            """, (user_id,)).fetchone()["total"]

            if int(count) + len(rewards) > database.INVENTORY_LIMIT:
                return jsonify({"error": "Недостаточно места"}), 400

            for reward in rewards:
                db.execute("""
                    INSERT INTO nft_inventory (
                        user_id,
                        nft_id,
                        background,
                        background_multiplier,
                        final_price,
                        source
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (
                    user_id,
                    reward["nft_id"],
                    reward["background"],
                    reward["background_multiplier"],
                    reward["final_price"],
                    "case"
                ))

            db.execute("""
                UPDATE nft_pending_rewards
                SET status = 'claimed',
                    completed_at = NOW()
                WHERE user_id = %s
                  AND batch_id = %s
                  AND status = 'pending'
            """, (user_id, batch_id))

        return jsonify({
            "success": True,
            "claimed": len(rewards)
        })

    except Exception as exc:
        print("CLAIM ERROR:", type(exc).__name__, str(exc))
        return jsonify({"error": "Ошибка получения наград"}), 500


@app.route("/api/rewards/sell", methods=["POST"])
def sell_rewards():
    user, error = require_user()

    if error:
        return error

    data = request.get_json(silent=True) or {}
    batch_id = data.get("batch_id")

    if not batch_id:
        return jsonify({"error": "Не указан batch_id"}), 400

    user_id = int(user["id"])

    try:
        uuid.UUID(str(batch_id))

        with database.get_db() as db:
            db.execute("""
                SELECT telegram_id
                FROM users
                WHERE telegram_id = %s
                FOR UPDATE
            """, (user_id,))

            rewards = db.execute("""
                SELECT *
                FROM nft_pending_rewards
                WHERE user_id = %s
                  AND batch_id = %s
                  AND status = 'pending'
                FOR UPDATE
            """, (user_id, batch_id)).fetchall()

            if not rewards:
                return jsonify({"error": "Награды уже обработаны"}), 404

            earned = sum(int(item["final_price"]) for item in rewards)

            player = db.execute("""
                SELECT balance
                FROM users
                WHERE telegram_id = %s
            """, (user_id,)).fetchone()

            new_balance = int(player["balance"]) + earned

            db.execute("""
                UPDATE users
                SET balance = %s
                WHERE telegram_id = %s
            """, (new_balance, user_id))

            db.execute("""
                INSERT INTO nft_g_transactions (
                    user_id, amount, balance_after, action, description
                )
                VALUES (%s, %s, %s, %s, %s)
            """, (
                user_id,
                earned,
                new_balance,
                "sell_case_rewards",
                f"Продажа наград из кейса {batch_id}"
            ))

            db.execute("""
                UPDATE nft_pending_rewards
                SET status = 'sold',
                    completed_at = NOW()
                WHERE user_id = %s
                  AND batch_id = %s
                  AND status = 'pending'
            """, (user_id, batch_id))

            db.execute("""
                UPDATE nft_player_stats
                SET nft_sold = nft_sold + %s,
                    total_earned = total_earned + %s
                WHERE user_id = %s
            """, (len(rewards), earned, user_id))

        return jsonify({
            "success": True,
            "sold": len(rewards),
            "earned": earned,
            "balance": new_balance
        })

    except Exception as exc:
        print("SELL REWARDS ERROR:", type(exc).__name__, str(exc))
        return jsonify({"error": "Ошибка продажи наград"}), 500


# -------------------------
# INVENTORY
# -------------------------

@app.route("/api/inventory")
def get_inventory():
    user, error = require_user()

    if error:
        return error

    inventory = database.get_inventory(user["id"])

    return jsonify({
        "success": True,
        "inventory": inventory,
        "count": len(inventory),
        "limit": database.INVENTORY_LIMIT
    })


@app.route("/api/skins")
def get_skins():
    user, error = require_user()

    if error:
        return error

    with database.get_db() as db:
        rows = db.execute("""
            SELECT id, code, name, rarity, base_price, image_url
            FROM nft_catalog
            WHERE is_active = TRUE
            ORDER BY base_price ASC
        """).fetchall()

    return jsonify({
        "success": True,
        "skins": [dict(row) for row in rows]
    })


@app.route("/api/skins/sell", methods=["POST"])
def sell_skin():
    user, error = require_user()

    if error:
        return error

    data = request.get_json(silent=True) or {}

    try:
        inventory_id = int(data.get("inventory_id"))
    except (TypeError, ValueError):
        return jsonify({"error": "Неверный ID NFT"}), 400

    user_id = int(user["id"])

    try:
        with database.get_db() as db:
            db.execute("""
                SELECT telegram_id
                FROM users
                WHERE telegram_id = %s
                FOR UPDATE
            """, (user_id,))

            item = db.execute("""
                SELECT id, final_price
                FROM nft_inventory
                WHERE id = %s AND user_id = %s
                FOR UPDATE
            """, (inventory_id, user_id)).fetchone()

            if not item:
                return jsonify({"error": "NFT не найден"}), 404

            earned = int(item["final_price"])

            player = db.execute("""
                SELECT balance
                FROM users
                WHERE telegram_id = %s
            """, (user_id,)).fetchone()

            new_balance = int(player["balance"]) + earned

            db.execute("""
                DELETE FROM nft_inventory
                WHERE id = %s AND user_id = %s
            """, (inventory_id, user_id))

            db.execute("""
                UPDATE users
                SET balance = %s
                WHERE telegram_id = %s
            """, (new_balance, user_id))

            db.execute("""
                INSERT INTO nft_g_transactions (
                    user_id, amount, balance_after, action, description
                )
                VALUES (%s, %s, %s, %s, %s)
            """, (
                user_id,
                earned,
                new_balance,
                "sell_nft",
                f"Продажа NFT #{inventory_id}"
            ))

            db.execute("""
                UPDATE nft_player_stats
                SET nft_sold = nft_sold + 1,
                    total_earned = total_earned + %s
                WHERE user_id = %s
            """, (earned, user_id))

        return jsonify({
            "success": True,
            "earned": earned,
            "balance": new_balance
        })

    except Exception as exc:
        print("SELL NFT ERROR:", type(exc).__name__, str(exc))
        return jsonify({"error": "Ошибка продажи NFT"}), 500


@app.route("/api/inventory/sell-all", methods=["POST"])
def sell_all_inventory():
    user, error = require_user()

    if error:
        return error

    user_id = int(user["id"])

    try:
        with database.get_db() as db:
            player = db.execute("""
                SELECT balance
                FROM users
                WHERE telegram_id = %s
                FOR UPDATE
            """, (user_id,)).fetchone()

            items = db.execute("""
                SELECT id, final_price
                FROM nft_inventory
                WHERE user_id = %s
                FOR UPDATE
            """, (user_id,)).fetchall()

            if not items:
                return jsonify({"error": "Инвентарь пуст"}), 400

            earned = sum(int(item["final_price"]) for item in items)
            new_balance = int(player["balance"]) + earned

            db.execute("""
                DELETE FROM nft_inventory
                WHERE user_id = %s
            """, (user_id,))

            db.execute("""
                UPDATE users
                SET balance = %s
                WHERE telegram_id = %s
            """, (new_balance, user_id))

            db.execute("""
                INSERT INTO nft_g_transactions (
                    user_id, amount, balance_after, action, description
                )
                VALUES (%s, %s, %s, %s, %s)
            """, (
                user_id,
                earned,
                new_balance,
                "sell_all",
                f"Продано NFT: {len(items)}"
            ))

            db.execute("""
                UPDATE nft_player_stats
                SET nft_sold = nft_sold + %s,
                    total_earned = total_earned + %s
                WHERE user_id = %s
            """, (len(items), earned, user_id))

        return jsonify({
            "success": True,
            "sold": len(items),
            "earned": earned,
            "balance": new_balance
        })

    except Exception as exc:
        print("SELL ALL ERROR:", type(exc).__name__, str(exc))
        return jsonify({"error": "Ошибка продажи NFT"}), 500


# -------------------------
# ADMIN
# -------------------------

@app.route("/api/admin/status")
def admin_status():
    user, error = require_user()

    if error:
        return error

    return jsonify({
        "success": True,
        "is_admin": (
            int(user["id"]) in ADMIN_IDS
            or database.is_admin(user["id"])
        )
    })


@app.route("/api/admin/give-g", methods=["POST"])
def admin_give_g():
    admin, error = require_admin()

    if error:
        return error

    data = request.get_json(silent=True) or {}

    try:
        game_id = int(str(data.get("game_id", "")).replace("#", ""))
        amount = int(data.get("amount"))
    except (TypeError, ValueError):
        return jsonify({"error": "Неверный игровой ID или сумма"}), 400

    if amount <= 0:
        return jsonify({"error": "Сумма должна быть больше нуля"}), 400

    target = database.get_player_by_game_id(game_id)

    if not target:
        return jsonify({"error": "Игрок не найден"}), 404

    try:
        balance = database.change_balance(
            target["telegram_id"],
            amount,
            "admin_give",
            f"Выдача администратором #{game_id}"
        )

        database.log_admin_action(
            admin["id"],
            "give_g",
            target["telegram_id"],
            {"amount": amount}
        )

        return jsonify({
            "success": True,
            "balance": balance
        })

    except Exception as exc:
        print("ADMIN GIVE G ERROR:", type(exc).__name__, str(exc))
        return jsonify({"error": "Не удалось выдать G"}), 500


@app.route("/api/admin/take-g", methods=["POST"])
def admin_take_g():
    admin, error = require_admin()

    if error:
        return error

    data = request.get_json(silent=True) or {}

    try:
        game_id = int(str(data.get("game_id", "")).replace("#", ""))
        amount = int(data.get("amount"))
    except (TypeError, ValueError):
        return jsonify({"error": "Неверный игровой ID или сумма"}), 400

    if amount <= 0:
        return jsonify({"error": "Сумма должна быть больше нуля"}), 400

    target = database.get_player_by_game_id(game_id)

    if not target:
        return jsonify({"error": "Игрок не найден"}), 404

    try:
        balance = database.change_balance(
            target["telegram_id"],
            -amount,
            "admin_take",
            f"Списание администратором #{game_id}"
        )

        database.log_admin_action(
            admin["id"],
            "take_g",
            target["telegram_id"],
            {"amount": amount}
        )

        return jsonify({
            "success": True,
            "balance": balance
        })

    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    except Exception as exc:
        print("ADMIN TAKE G ERROR:", type(exc).__name__, str(exc))
        return jsonify({"error": "Не удалось списать G"}), 500


@app.route("/api/admin/give-nft", methods=["POST"])
def admin_give_nft():
    admin, error = require_admin()

    if error:
        return error

    data = request.get_json(silent=True) or {}

    try:
        game_id = int(str(data.get("game_id", "")).replace("#", ""))
        nft_code = str(data.get("nft_code", ""))
        background = str(data.get("background", "normal"))
    except (TypeError, ValueError):
        return jsonify({"error": "Неверные данные"}), 400

    if background not in ("normal", "gold", "onyx_black", "black"):
        return jsonify({"error": "Неверный фон"}), 400

    target = database.get_player_by_game_id(game_id)

    if not target:
        return jsonify({"error": "Игрок не найден"}), 404

    multipliers = {
        "normal": 1,
        "gold": 3,
        "onyx_black": 5,
        "black": 10
    }

    try:
        with database.get_db() as db:
            db.execute("""
                SELECT telegram_id
                FROM users
                WHERE telegram_id = %s
                FOR UPDATE
            """, (target["telegram_id"],))

            count = db.execute("""
                SELECT COUNT(*) AS total
                FROM nft_inventory
                WHERE user_id = %s
            """, (target["telegram_id"],)).fetchone()["total"]

            if int(count) >= database.INVENTORY_LIMIT:
                return jsonify({"error": "Инвентарь заполнен"}), 400

            nft = db.execute("""
                SELECT id, base_price
                FROM nft_catalog
                WHERE code = %s AND is_active = TRUE
            """, (nft_code,)).fetchone()

            if not nft:
                return jsonify({"error": "NFT не найден"}), 404

            multiplier = multipliers[background]
            price = int(nft["base_price"]) * multiplier

            db.execute("""
                INSERT INTO nft_inventory (
                    user_id, nft_id, background,
                    background_multiplier, final_price, source
                )
                VALUES (%s, %s, %s, %s, %s, 'admin')
            """, (
                target["telegram_id"],
                nft["id"],
                background,
                multiplier,
                price
            ))

        database.log_admin_action(
            admin["id"],
            "give_nft",
            target["telegram_id"],
            {
                "nft_code": nft_code,
                "background": background
            }
        )

        return jsonify({"success": True})

    except Exception as exc:
        print("ADMIN GIVE NFT ERROR:", type(exc).__name__, str(exc))
        return jsonify({"error": "Не удалось выдать NFT"}), 500


# -------------------------
# UPGRADE AND CRAFT MODULES
# -------------------------

app.register_blueprint(
    upgrade.create_upgrade_blueprint(authorized_game_user)
)

app.register_blueprint(
    craft.create_craft_blueprint(authorized_game_user)
)


# -------------------------
# STARTUP
# -------------------------

def initialize():
    database.init_db()

    for admin_id in ADMIN_IDS:
        database.add_admin(admin_id)

    init_catalog()


initialize()


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", 5000)),
        debug=False
    )
