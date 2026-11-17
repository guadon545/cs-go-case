
import secrets

from flask import Blueprint, request, jsonify
from psycopg.types.json import Jsonb

import database


BACKGROUND = "normal"
BACKGROUND_MULTIPLIER = 1

CRAFT_MULTIPLIERS = [
    (0.25, 20),
    (0.50, 25),
    (0.75, 20),
    (1.00, 15),
    (1.25, 10),
    (1.50, 7),
    (2.00, 3),
]


def get_user_id(user):
    if isinstance(user, dict):
        return user.get("telegram_id")
    return user


def choose_multiplier():
    total_weight = sum(weight for _, weight in CRAFT_MULTIPLIERS)
    roll = secrets.randbelow(total_weight)

    current = 0

    for multiplier, weight in CRAFT_MULTIPLIERS:
        current += weight

        if roll < current:
            return multiplier

    return 1.0


def choose_reward(catalog, target_price):
    if not catalog:
        return None

    ordered = sorted(
        catalog,
        key=lambda item: (
            abs(int(item["base_price"]) - target_price),
            int(item["base_price"])
        )
    )

    # Выбираем случайно среди пяти ближайших NFT.
    candidates = ordered[:min(5, len(ordered))]

    return secrets.choice(candidates)


def create_craft_blueprint(authorized_user):
    craft_bp = Blueprint("craft_api", __name__)

    def current_user():
        user = authorized_user()

        if not user:
            return None

        return get_user_id(user)

    @craft_bp.route("/api/craft/options", methods=["GET"])
    def craft_options():
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

        return jsonify({
            "success": True,
            "inventory": inventory,
            "required_items": 5,
            "multipliers": [
                {
                    "value": multiplier,
                    "weight": weight
                }
                for multiplier, weight in CRAFT_MULTIPLIERS
            ]
        })

    @craft_bp.route("/api/craft", methods=["POST"])
    def perform_craft():
        user_id = current_user()

        if not user_id:
            return jsonify({
                "success": False,
                "error": "Необходима авторизация"
            }), 401

        data = request.get_json(silent=True) or {}
        raw_ids = data.get("inventory_ids")

        if not isinstance(raw_ids, list) or len(raw_ids) != 5:
            return jsonify({
                "success": False,
                "error": "Для крафта нужно выбрать ровно 5 NFT"
            }), 400

        try:
            inventory_ids = [int(item_id) for item_id in raw_ids]
        except (TypeError, ValueError):
            return jsonify({
                "success": False,
                "error": "Некорректные ID NFT"
            }), 400

        if any(item_id <= 0 for item_id in inventory_ids):
            return jsonify({
                "success": False,
                "error": "Некорректные ID NFT"
            }), 400

        if len(set(inventory_ids)) != 5:
            return jsonify({
                "success": False,
                "error": "Нельзя использовать один NFT несколько раз"
            }), 400

        try:
            with database.get_db() as conn:
                with conn.cursor() as cur:

                    # Блокируем строку игрока.
                    cur.execute("""
                        SELECT telegram_id
                        FROM users
                        WHERE telegram_id = %s
                        FOR UPDATE
                    """, (user_id,))

                    player = cur.fetchone()

                    if not player:
                        return jsonify({
                            "success": False,
                            "error": "Игрок не найден"
                        }), 404

                    # Блокируем все выбранные NFT.
                    cur.execute("""
                        SELECT
                            i.id,
                            i.nft_id,
                            i.final_price,
                            c.name,
                            c.code
                        FROM nft_inventory i
                        JOIN nft_catalog c ON c.id = i.nft_id
                        WHERE i.user_id = %s
                          AND i.id = ANY(%s)
                        ORDER BY i.id
                        FOR UPDATE OF i
                    """, (user_id, inventory_ids))

                    items = cur.fetchall()

                    if len(items) != 5:
                        return jsonify({
                            "success": False,
                            "error": "Не все NFT найдены в инвентаре"
                        }), 400

                    total_price = sum(
                        int(item["final_price"])
                        for item in items
                    )

                    if total_price <= 0:
                        return jsonify({
                            "success": False,
                            "error": "Общая стоимость NFT должна быть больше нуля"
                        }), 400

                    # Проверяем вместимость после крафта.
                    cur.execute("""
                        SELECT COUNT(*) AS total
                        FROM nft_inventory
                        WHERE user_id = %s
                    """, (user_id,))

                    inventory_count = int(
                        cur.fetchone()["total"]
                    )

                    if inventory_count - 5 + 1 > database.INVENTORY_LIMIT:
                        return jsonify({
                            "success": False,
                            "error": "Недостаточно места в инвентаре"
                        }), 400

                    multiplier = choose_multiplier()
                    target_price = total_price * multiplier

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
                    """)

                    catalog = cur.fetchall()

                    if not catalog:
                        return jsonify({
                            "success": False,
                            "error": "Каталог NFT пуст"
                        }), 500

                    reward = choose_reward(catalog, target_price)

                    if not reward:
                        return jsonify({
                            "success": False,
                            "error": "Не удалось выбрать награду"
                        }), 500

                    reward_price = int(reward["base_price"])

                    # Списываем пять исходных NFT.
                    cur.execute("""
                        DELETE FROM nft_inventory
                        WHERE user_id = %s
                          AND id = ANY(%s)
                    """, (user_id, inventory_ids))

                    if cur.rowcount != 5:
                        raise RuntimeError(
                            "Не удалось списать все пять NFT"
                        )

                    # Выдаём новый NFT.
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
                        reward["id"],
                        BACKGROUND,
                        BACKGROUND_MULTIPLIER,
                        reward_price,
                        "craft"
                    ))

                    new_item = cur.fetchone()
                    reward_inventory_id = new_item["id"]

                    used_items = [
                        {
                            "inventory_id": item["id"],
                            "nft_id": item["nft_id"],
                            "name": item["name"],
                            "code": item["code"],
                            "price": int(item["final_price"])
                        }
                        for item in items
                    ]

                    # Записываем историю.
                    cur.execute("""
                        INSERT INTO nft_craft_history (
                            user_id,
                            items_used,
                            total_price,
                            reward_inventory_id,
                            reward_nft_id,
                            reward_price,
                            multiplier
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (
                        user_id,
                        Jsonb(used_items),
                        total_price,
                        reward_inventory_id,
                        reward["id"],
                        reward_price,
                        multiplier
                    ))

                    # Обновляем статистику.
                    cur.execute("""
                        INSERT INTO nft_player_stats (
                            user_id,
                            crafts_completed
                        )
                        VALUES (%s, 1)
                        ON CONFLICT (user_id)
                        DO UPDATE SET
                            crafts_completed =
                                nft_player_stats.crafts_completed + 1
                    """, (user_id,))

            return jsonify({
                "success": True,
                "message": "КРАФТ УСПЕШЕН!",
                "used_items": used_items,
                "total_price": total_price,
                "multiplier": multiplier,
                "target_price": target_price,
                "reward": {
                    "inventory_id": reward_inventory_id,
                    "id": reward["id"],
                    "code": reward["code"],
                    "name": reward["name"],
                    "rarity": reward["rarity"],
                    "price": reward_price,
                    "image_url": reward["image_url"],
                    "background": BACKGROUND,
                    "background_multiplier": BACKGROUND_MULTIPLIER
                }
            })

        except Exception as exc:
            print(
                "CRAFT ERROR:",
                type(exc).__name__,
                str(exc)
            )

            return jsonify({
                "success": False,
                "error": "Ошибка выполнения крафта"
            }), 500

    return craft_bp
