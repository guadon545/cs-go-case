
import secrets

from flask import Blueprint, request, jsonify
import database


OPTIONS = {
    "multiplier": {
        "x2": {
            "chance": 50.0,
            "multiplier": 2.0
        },
        "x5": {
            "chance": 30.0,
            "multiplier": 5.0
        },
        "x10": {
            "chance": 10.0,
            "multiplier": 10.0
        }
    },
    "chance": {
        "30": {
            "chance": 30.0,
            "multiplier": 3.5
        },
        "50": {
            "chance": 50.0,
            "multiplier": 2.0
        },
        "75": {
            "chance": 75.0,
            "multiplier": 1.333333
        }
    }
}


def create_upgrade_blueprint(authorized_user):
    upgrade_bp = Blueprint("upgrade_api", __name__)

    @upgrade_bp.route("/api/upgrade", methods=["POST"])
    def perform_upgrade():
        user = authorized_user()

        if not user:
            return jsonify({
                "success": False,
                "error": "Telegram authorization failed"
            }), 401

        user_id = int(user["id"])
        data = request.get_json(silent=True) or {}

        try:
            source_id = int(data.get("source_skin_id"))
        except (TypeError, ValueError):
            return jsonify({
                "success": False,
                "error": "Неверный ID исходного скина"
            }), 400

        mode = str(data.get("mode", ""))
        option = str(data.get("option", ""))

        config = OPTIONS.get(mode, {}).get(option)

        if not config:
            return jsonify({
                "success": False,
                "error": "Неверный режим апгрейда"
            }), 400

        if source_id <= 0:
            return jsonify({
                "success": False,
                "error": "Неверный ID скина"
            }), 400

        chance = float(config["chance"])
        multiplier = float(config["multiplier"])

        if chance <= 0 or chance > 80:
            return jsonify({
                "success": False,
                "error": "Недопустимый шанс"
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
                        "success": False,
                        "error": "Игрок не найден"
                    }), 404

                if player["is_banned"]:
                    return jsonify({
                        "success": False,
                        "error": "Аккаунт заблокирован"
                    }), 403

                source = db.execute("""
                    SELECT id, name, rarity, price
                    FROM skins
                    WHERE id = %s
                """, (source_id,)).fetchone()

                if not source:
                    return jsonify({
                        "success": False,
                        "error": "Исходный скин не найден"
                    }), 404

                source_price = int(source["price"])

                if source_price <= 0:
                    return jsonify({
                        "success": False,
                        "error": "Некорректная цена исходного скина"
                    }), 400

                item = db.execute("""
                    SELECT quantity
                    FROM inventory
                    WHERE user_id = %s
                    AND skin_id = %s
                    FOR UPDATE
                """, (user_id, source_id)).fetchone()

                if not item or int(item["quantity"]) < 1:
                    return jsonify({
                        "success": False,
                        "error": "Исходного скина нет в инвентаре"
                    }), 400

                desired_price = int(round(
                    source_price * multiplier
                ))

                min_price = max(
                    source_price + 1,
                    int(desired_price * 0.80)
                )

                max_price = int(desired_price * 1.20)

                candidates = db.execute("""
                    SELECT id, name, rarity, price
                    FROM skins
                    WHERE id <> %s
                    AND price >= %s
                    AND price <= %s
                    ORDER BY ABS(price - %s) ASC
                    LIMIT 30
                """, (
                    source_id,
                    min_price,
                    max_price,
                    desired_price
                )).fetchall()

                if not candidates:
                    return jsonify({
                        "success": False,
                        "error": (
                            "Нет скинов подходящей стоимости "
                            "для этого режима. Попробуй другой "
                            "множитель или ставку."
                        )
                    }), 400

                target = secrets.choice(candidates)

                target_id = int(target["id"])
                target_price = int(target["price"])

                roll = secrets.randbelow(10000) / 100
                won = roll < chance

                # Списываем исходный скин.
                if int(item["quantity"]) == 1:
                    db.execute("""
                        DELETE FROM inventory
                        WHERE user_id = %s
                        AND skin_id = %s
                    """, (user_id, source_id))
                else:
                    db.execute("""
                        UPDATE inventory
                        SET quantity = quantity - 1
                        WHERE user_id = %s
                        AND skin_id = %s
                    """, (user_id, source_id))

                # При победе выдаём целевой скин.
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
                        SET successful_upgrades =
                            successful_upgrades + 1
                        WHERE user_id = %s
                    """, (user_id,))

                    db.execute("""
                        INSERT INTO item_history
                        (user_id, skin_id, skin_name,
                         skin_price, source)
                        VALUES (%s, %s, %s, %s, %s)
                    """, (
                        user_id,
                        target_id,
                        target["name"],
                        target_price,
                        "upgrade"
                    ))

                return jsonify({
                    "success": True,
                    "won": won,
                    "chance": chance,
                    "roll": round(roll, 2),
                    "mode": mode,
                    "option": option,
                    "multiplier": multiplier,
                    "source": {
                        "id": source_id,
                        "name": source["name"],
                        "price": source_price
                    },
                    "target": {
                        "id": target_id,
                        "name": target["name"],
                        "rarity": target["rarity"],
                        "price": target_price
                    },
                    "message": (
                        "Апгрейд успешен!"
                        if won else
                        "Неудача! Исходный скин сгорел."
                    )
                })

        except Exception as error:
            print(
                "UPGRADE ERROR:",
                type(error).__name__,
                str(error)
            )

            return jsonify({
                "success": False,
                "error": "Ошибка выполнения апгрейда"
            }), 500

    return upgrade_bp
