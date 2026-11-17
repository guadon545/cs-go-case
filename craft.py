
import random
from collections import Counter

from flask import Blueprint, request, jsonify
import database


MULTIPLIERS = [
    {"value": 0.5, "numerator": 1, "denominator": 2, "chance": 20},
    {"value": 0.75, "numerator": 3, "denominator": 4, "chance": 20},
    {"value": 1, "numerator": 1, "denominator": 1, "chance": 20},
    {"value": 1.5, "numerator": 3, "denominator": 2, "chance": 17},
    {"value": 2, "numerator": 2, "denominator": 1, "chance": 12},
    {"value": 2.5, "numerator": 5, "denominator": 2, "chance": 7},
    {"value": 3, "numerator": 3, "denominator": 1, "chance": 4},
]


def create_craft_blueprint(authorized_user):
    craft_bp = Blueprint("craft", __name__)

    @craft_bp.route("/api/craft", methods=["GET"])
    def get_craft_data():
        user = authorized_user()

        if not user:
            return jsonify({"error": "Authorization failed"}), 401

        with database.get_db() as db:
            player = db.execute("""
                SELECT is_banned
                FROM users
                WHERE telegram_id = %s
            """, (user["id"],)).fetchone()

            if not player:
                return jsonify({"error": "Игрок не найден"}), 404

            if player["is_banned"]:
                return jsonify({"error": "Аккаунт заблокирован"}), 403

            inventory = db.execute("""
                SELECT
                    skins.id AS skin_id,
                    skins.name,
                    skins.rarity,
                    skins.price,
                    inventory.quantity
                FROM inventory
                JOIN skins ON skins.id = inventory.skin_id
                WHERE inventory.user_id = %s
                  AND inventory.quantity > 0
                ORDER BY skins.price DESC
            """, (user["id"],)).fetchall()

        return jsonify({
            "inventory": [dict(item) for item in inventory],
            "required_items": 5,
            "multipliers": [
                {
                    "multiplier": item["value"],
                    "chance": item["chance"]
                }
                for item in MULTIPLIERS
            ]
        })

    @craft_bp.route("/api/craft", methods=["POST"])
    def run_craft():
        user = authorized_user()

        if not user:
            return jsonify({"error": "Authorization failed"}), 401

        data = request.get_json(silent=True) or {}
        selected = data.get("items")

        if not isinstance(selected, list) or len(selected) != 5:
            return jsonify({
                "error": "Для крафта нужно выбрать ровно 5 предметов"
            }), 400

        try:
            skin_ids = [int(item) for item in selected]
        except (TypeError, ValueError):
            return jsonify({"error": "Неверные ID предметов"}), 400

        if any(skin_id <= 0 for skin_id in skin_ids):
            return jsonify({"error": "Неверные ID предметов"}), 400

        required = Counter(skin_ids)
        user_id = int(user["id"])

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

                placeholders = ",".join(
                    ["%s"] * len(required)
                )

                rows = db.execute(f"""
                    SELECT
                        skins.id,
                        skins.name,
                        skins.rarity,
                        skins.price,
                        inventory.quantity
                    FROM inventory
                    JOIN skins ON skins.id = inventory.skin_id
                    WHERE inventory.user_id = %s
                      AND skins.id IN ({placeholders})
                    FOR UPDATE OF inventory
                """, (user_id, *required.keys())).fetchall()

                available = {
                    row["id"]: row for row in rows
                }

                for skin_id, amount in required.items():
                    item = available.get(skin_id)

                    if not item or item["quantity"] < amount:
                        return jsonify({
                            "error": "Недостаточно предметов в инвентаре"
                        }), 400

                total_price = sum(
                    int(available[skin_id]["price"]) * amount
                    for skin_id, amount in required.items()
                )

                if total_price <= 0:
                    return jsonify({
                        "error": "Общая стоимость предметов должна быть больше нуля"
                    }), 400

                result = random.choices(
                    MULTIPLIERS,
                    weights=[
                        item["chance"] for item in MULTIPLIERS
                    ],
                    k=1
                )[0]

                multiplier = result["value"]

                reward_price = (
                    total_price * result["numerator"]
                    // result["denominator"]
                )

                if reward_price <= 0:
                    return jsonify({
                        "error": "Стоимость результата слишком мала"
                    }), 400

                for skin_id, amount in required.items():
                    db.execute("""
                        UPDATE inventory
                        SET quantity = quantity - %s
                        WHERE user_id = %s AND skin_id = %s
                    """, (amount, user_id, skin_id))

                    db.execute("""
                        DELETE FROM inventory
                        WHERE user_id = %s
                          AND skin_id = %s
                          AND quantity <= 0
                    """, (user_id, skin_id))

                multiplier_name = str(multiplier).replace(".", ",")

                new_skin = db.execute("""
                    INSERT INTO skins (name, rarity, price)
                    VALUES (%s, 'Craft', %s)
                    RETURNING id, name, rarity, price
                """, (
                    f"GUADON CRAFT ×{multiplier_name}",
                    reward_price
                )).fetchone()

                new_skin_id = new_skin["id"]

                db.execute("""
                    INSERT INTO inventory (user_id, skin_id, quantity)
                    VALUES (%s, %s, 1)
                    ON CONFLICT (user_id, skin_id)
                    DO UPDATE SET quantity =
                        inventory.quantity + EXCLUDED.quantity
                """, (user_id, new_skin_id))

            return jsonify({
                "success": True,
                "message": "Крафт успешно завершён!",
                "items_used": 5,
                "total_price": total_price,
                "multiplier": multiplier,
                "chance": result["chance"],
                "reward_price": reward_price,
                "skin": dict(new_skin)
            })

        except Exception as error:
            print("CRAFT ERROR:", type(error).__name__)
            return jsonify({
                "error": "Ошибка выполнения крафта"
            }), 500

    return craft_bp
