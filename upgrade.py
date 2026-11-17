
import secrets

from flask import Blueprint, request, jsonify

import database


MULTIPLIER_CHANCES = {
    2: 50.0,
    5: 30.0,
    10: 10.0,
}

PERCENT_CHANCES = {30.0, 50.0, 75.0}

BACKGROUNDS = {
    "normal": 1,
    "gold": 3,
    "onyx_black": 5,
    "black": 10,
}


def get_user_id(user):
    if isinstance(user, dict):
        return user.get("telegram_id")
    return user


def parse_positive_id(value):
    try:
        result = int(value)
        return result if result > 0 else None
    except (TypeError, ValueError):
        return None


def create_upgrade_blueprint(authorized_user):
    upgrade_bp = Blueprint("upgrade_api", __name__)

    def current_user():
        user = authorized_user()
        return get_user_id(user) if user else None

    @upgrade_bp.route("/api/upgrade/options", methods=["GET"])
    def upgrade_options():
        user_id = current_user()

        if not user_id:
            return jsonify({
                "success": False,
                "error": "Необходима авторизация"
            }), 401

        with database.get_db() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT
                        i.id AS inventory_id,
                        i.nft_id,
                        c.code,
                        c.name,
                        c.rarity,
                        c.base_price,
                        c.image_url,
                        i.background,
                        i.background_multiplier,
                        i.final_price,
                        i.acquired_at
                    FROM nft_inventory i
                    JOIN nft_catalog c ON c.id = i.nft_id
                    WHERE i.user_id = %s
                    ORDER BY i.final_price DESC, i.acquired_at DESC
                """, (user_id,))

                inventory = cur.fetchall()

                cur.execute("""
                    SELECT
                        id,
                        code,
                        name,
                        rarity,
                        base_price,
                        image_url
                    FROM nft_catalog
                    WHERE is_active = TRUE
                    ORDER BY base_price ASC
                """)

                catalog = cur.fetchall()

        return jsonify({
            "success": True,
            "inventory": inventory,
            "catalog": catalog,
            "multipliers": [
                {"value": 2, "chance": 50},
                {"value": 5, "chance": 30},
                {"value": 10, "chance": 10}
            ],
            "percent_chances": [30, 50, 75],
            "backgrounds": [
                {"code": "normal", "multiplier": 1},
                {"code": "gold", "multiplier": 3},
                {"code": "onyx_black", "multiplier": 5},
                {"code": "black", "multiplier": 10}
            ]
        })

    @upgrade_bp.route("/api/upgrade", methods=["POST"])
    def perform_upgrade():
        user_id = current_user()

        if not user_id:
            return jsonify({
                "success": False,
                "error": "Необходима авторизация"
            }), 401

        data = request.get_json(silent=True) or {}

        inventory_id = parse_positive_id(data.get("inventory_id"))
        target_background = data.get("target_background", "normal")
        mode = data.get("mode", "multiplier")

        if not inventory_id:
            return jsonify({
                "success": False,
                "error": "Выбери исходный NFT"
            }), 400

        if target_background not in BACKGROUNDS:
            return jsonify({
                "success": False,
                "error": "Неверный фон"
            }), 400

        if mode == "multiplier":
            try:
                multiplier = int(data.get("multiplier"))
            except (TypeError, ValueError):
                return jsonify({
                    "success": False,
                    "error": "Неверный множитель"
                }), 400

            if multiplier not in MULTIPLIER_CHANCES:
                return jsonify({
                    "success": False,
                    "error": "Недоступный множитель"
                }), 400

            chance = MULTIPLIER_CHANCES[multiplier]
            expected_multiplier = float(multiplier)

        elif mode == "percent":
            try:
                chance = float(data.get("chance"))
            except (TypeError, ValueError):
                return jsonify({
                    "success": False,
                    "error": "Укажи шанс победы"
                }), 400

            if chance not in PERCENT_CHANCES:
                return jsonify({
                    "success": False,
                    "error": "Доступны только шансы 30%, 50% и 75%"
                }), 400

            multiplier = 0
            expected_multiplier = 100.0 / chance

        else:
            return jsonify({
                "success": False,
                "error": "Неверный режим апгрейда"
            }), 400

        background_multiplier = BACKGROUNDS[target_background]

        try:
            with database.get_db() as conn:
                with conn.cursor() as cur:

                    # Блокируем исходный NFT, чтобы его нельзя было
                    # одновременно использовать в нескольких апгрейдах.
                    cur.execute("""
                        SELECT
                            i.id,
                            i.nft_id,
                            i.final_price,
                            c.name
                        FROM nft_inventory i
                        JOIN nft_catalog c ON c.id = i.nft_id
                        WHERE i.id = %s
                          AND i.user_id = %s
                        FOR UPDATE OF i
                    """, (inventory_id, user_id))

                    source = cur.fetchone()

                    if not source:
                        return jsonify({
                            "success": False,
                            "error": "Исходный NFT не найден"
                        }), 404

                    source_price = int(source["final_price"])

                    if source_price <= 0:
                        return jsonify({
                            "success": False,
                            "error": "Некорректная стоимость исходного NFT"
                        }), 400

                    # Рассчитываем допустимую стоимость награды.
                    expected_price = source_price * expected_multiplier
                    min_price = expected_price * 0.75
                    max_price = expected_price * 1.25

                    # Сервер сам выбирает случайный NFT.
                    # Переданный браузером target_nft_id не используется.
                    min_base_price = min_price / background_multiplier
                    max_base_price = max_price / background_multiplier

                    cur.execute("""
                        SELECT
                            id,
                            code,
                            name,
                            rarity,
                            base_price,
                            image_url
                        FROM nft_catalog
                        WHERE is_active = TRUE
                          AND base_price BETWEEN %s AND %s
                        ORDER BY RANDOM()
                        LIMIT 1
                    """, (min_base_price, max_base_price))

                    target = cur.fetchone()

                    if not target:
                        return jsonify({
                            "success": False,
                            "error": "Нет NFT подходящей стоимости. Выбери другой фон или режим.",
                            "min_price": int(min_price),
                            "max_price": int(max_price)
                        }), 400

                    target_price = (
                        int(target["base_price"]) * background_multiplier
                    )

                    # Дополнительная проверка стоимости на сервере.
                    if not min_price <= target_price <= max_price:
                        return jsonify({
                            "success": False,
                            "error": "Стоимость выбранной награды не подходит"
                        }), 400

                    # Сервер самостоятельно определяет победу.
                    won = (
                        secrets.randbelow(100000)
                        < int(chance * 1000)
                    )

                    # Списываем исходный NFT.
                    cur.execute("""
                        DELETE FROM nft_inventory
                        WHERE id = %s
                          AND user_id = %s
                    """, (inventory_id, user_id))

                    if cur.rowcount != 1:
                        raise RuntimeError(
                            "Не удалось списать исходный NFT"
                        )

                    new_inventory_id = None

                    if won:
                        cur.execute("""
                            INSERT INTO nft_inventory (
                                user_id,
                                nft_id,
                                background,
                                background_multiplier,
                                final_price,
                                source
                            )
                            VALUES (%s, %s, %s, %s, %s, %s)
                            RETURNING id
                        """, (
                            user_id,
                            target["id"],
                            target_background,
                            background_multiplier,
                            target_price,
                            "upgrade"
                        ))

                        new_item = cur.fetchone()
                        new_inventory_id = new_item["id"]

                    # Сохраняем историю.
                    cur.execute("""
                        INSERT INTO nft_upgrade_history (
                            user_id,
                            source_inventory_id,
                            target_nft_id,
                            target_background,
                            multiplier,
                            chance,
                            won
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (
                        user_id,
                        inventory_id,
                        target["id"],
                        target_background,
                        multiplier,
                        chance,
                        won
                    ))

                    # Обновляем статистику.
                    cur.execute("""
                        INSERT INTO nft_player_stats (
                            user_id,
                            upgrades_played,
                            upgrades_won
                        )
                        VALUES (%s, 1, %s)
                        ON CONFLICT (user_id)
                        DO UPDATE SET
                            upgrades_played =
                                nft_player_stats.upgrades_played + 1,
                            upgrades_won =
                                nft_player_stats.upgrades_won
                                + EXCLUDED.upgrades_won
                    """, (
                        user_id,
                        1 if won else 0
                    ))

            if won:
                return jsonify({
                    "success": True,
                    "won": True,
                    "chance": chance,
                    "message": "ПОБЕДА!",
                    "source": {
                        "name": source["name"],
                        "price": source_price
                    },
                    "reward": {
                        "inventory_id": new_inventory_id,
                        "id": target["id"],
                        "code": target["code"],
                        "name": target["name"],
                        "rarity": target["rarity"],
                        "price": target_price,
                        "image_url": target["image_url"],
                        "background": target_background,
                        "background_multiplier": background_multiplier
                    }
                })

            return jsonify({
                "success": True,
                "won": False,
                "chance": chance,
                "message": "НЕУДАЧА! NFT сгорел",
                "lost": {
                    "name": source["name"],
                    "price": source_price
                }
            })

        except Exception as exc:
            print(
                "UPGRADE ERROR:",
                type(exc).__name__,
                str(exc)
            )

            return jsonify({
                "success": False,
                "error": "Ошибка выполнения апгрейда"
            }), 500

    return upgrade_bp
