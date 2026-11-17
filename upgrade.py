import secrets

from flask import Blueprint, request, jsonify
import database


def create_upgrade_blueprint(authorized_user):
    upgrade_bp = Blueprint("upgrade_api", __name__)

    @upgrade_bp.route("/api/upgrade", methods=["POST"])
    def perform_upgrade():
        user = authorized_user()

        if not user:
            return jsonify({
                "error": "Telegram authorization failed"
            }), 401

        user_id = int(user["id"])
        data = request.get_json(silent=True) or {}

        try:
            source_id = int(data.get("source_skin_id"))
            target_id = int(data.get("target_skin_id"))
        except (TypeError, ValueError):
            return jsonify({"error": "Неверные данные"}), 400

        if source_id <= 0 or target_id <= 0:
            return jsonify({"error": "Неверный ID скина"}), 400

        if source_id == target_id:
            return jsonify({
                "error": "Нельзя улучшить скин в самого себя"
            }), 400

        try:
            with database.get_db() as db:
                player = db.execute("""
                    SELECT is_banned
                    FROM users
                    WHERE telegram_id = %s
                    FOR UPDATE
                """, (user_id,)).fetchone()

                if not player:
                    return jsonify({
                        "error": "Игрок не найден"
                    }), 404

                if player["is_banned"]:
                    return jsonify({
                        "error": "Аккаунт заблокирован"
                    }), 403

                source = db.execute("""
                    SELECT id, name, rarity, price
                    FROM skins
                    WHERE id = %s
                """, (source_id,)).fetchone()

                target = db.execute("""
                    SELECT id, name, rarity, price
                    FROM skins
                    WHERE id = %s
                """, (target_id,)).fetchone()

                if not source or not target:
                    return jsonify({
                        "error": "Скин не найден"
                    }), 404

                source_price = int(source["price"])
                target_price = int(target["price"])

                if source_price <= 0 or target_price <= source_price:
                    return jsonify({
                        "error": "Целевой скин должен быть дороже исходного"
                    }), 400

                item = db.execute("""
                    SELECT quantity
                    FROM inventory
                    WHERE user_id = %s AND skin_id = %s
                    FOR UPDATE
                """, (user_id, source_id)).fetchone()

                if not item or item["quantity"] < 1:
                    return jsonify({
                        "error": "Исходного скина нет в инвентаре"
                    }), 400

                chance = min(
                    90.0,
                    source_price / target_price * 90.0
                )

                roll = secrets.randbelow(10000) / 100
                won = roll < chance

                if item["quantity"] == 1:
                    db.execute("""
                        DELETE FROM inventory
                        WHERE user_id = %s AND skin_id = %s
                    """, (user_id, source_id))
                else:
                    db.execute("""
                        UPDATE inventory
                        SET quantity = quantity - 1
                        WHERE user_id = %s AND skin_id = %s
                    """, (user_id, source_id))

                if won:
                    db.execute("""
                        INSERT INTO inventory
                        (user_id, skin_id, quantity)
                        VALUES (%s, %s, 1)
                        ON CONFLICT (user_id, skin_id)
                        DO UPDATE SET quantity =
                            inventory.quantity + EXCLUDED.quantity
                    """, (user_id, target_id))

                    db.execute("""
                        INSERT INTO profile_stats (user_id)
                        VALUES (%s)
                        ON CONFLICT (user_id) DO NOTHING
                    """, (user_id,))

                    db.execute("""
                        UPDATE profile_stats
                        SET successful_upgrades = successful_upgrades + 1
                        WHERE user_id = %s
                    """, (user_id,))

                    db.execute("""
                        INSERT INTO item_history
                        (user_id, skin_id, skin_name, skin_price, source)
                        VALUES (%s, %s, %s, %s, %s)
                    """, (
                        user_id,
                        target["id"],
                        target["name"],
                        target_price,
                        "upgrade"
                    ))

                return jsonify({
                    "success": True,
                    "won": won,
                    "chance": round(chance, 2),
                    "roll": round(roll, 2),
                    "source": {
                        "id": source["id"],
                        "name": source["name"],
                        "price": source_price
                    },
                    "target": {
                        "id": target["id"],
                        "name": target["name"],
                        "price": target_price
                    },
                    "message": (
                        "Апгрейд успешен!"
                        if won else
                        "Неудача! Исходный скин сгорел."
                    )
                })

        except Exception as error:
            print("UPGRADE ERROR:", type(error).__name__)
            return jsonify({
                "error": "Ошибка выполнения апгрейда"
            }), 500

    return upgrade_bp

