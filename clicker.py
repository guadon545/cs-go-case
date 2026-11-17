
import time

from flask import Blueprint, request, jsonify
import database


CLICK_REWARD = 1
CLICK_COOLDOWN = 0.1


def create_clicker_blueprint(authorized_user):
    clicker_bp = Blueprint("clicker_api", __name__)

    @clicker_bp.route("/api/clicker", methods=["GET"])
    def get_clicker():
        user = authorized_user()

        if not user:
            return jsonify({
                "error": "Telegram authorization failed"
            }), 401

        user_id = int(user["id"])

        with database.get_db() as db:
            player = db.execute("""
                SELECT balance, total_clicks, click_level, is_banned
                FROM users
                WHERE telegram_id = %s
            """, (user_id,)).fetchone()

            if not player:
                return jsonify({
                    "error": "Игрок не найден"
                }), 404

            if player["is_banned"]:
                return jsonify({
                    "error": "Аккаунт заблокирован"
                }), 403

            return jsonify({
                "success": True,
                "balance": player["balance"],
                "total_clicks": player["total_clicks"],
                "click_level": player["click_level"],
                "reward_per_click": CLICK_REWARD
            })

    @clicker_bp.route("/api/clicker/click", methods=["POST"])
    def make_click():
        user = authorized_user()

        if not user:
            return jsonify({
                "error": "Telegram authorization failed"
            }), 401

        user_id = int(user["id"])
        now = time.time()

        try:
            with database.get_db() as db:
                player = db.execute("""
                    SELECT balance, total_clicks, last_click_at, is_banned
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

                last_click = float(player["last_click_at"] or 0)
                elapsed = now - last_click

                if elapsed < CLICK_COOLDOWN:
                    return jsonify({
                        "success": False,
                        "error": "Слишком быстро! Подожди немного.",
                        "cooldown": round(
                            CLICK_COOLDOWN - elapsed, 2
                        )
                    }), 429

                new_balance = int(player["balance"]) + CLICK_REWARD
                new_clicks = int(player["total_clicks"]) + 1

                db.execute("""
                    UPDATE users
                    SET balance = %s,
                        total_clicks = %s,
                        last_click_at = %s
                    WHERE telegram_id = %s
                """, (
                    new_balance,
                    new_clicks,
                    now,
                    user_id
                ))

                db.execute("""
                    INSERT INTO transactions
                    (user_id, amount, action)
                    VALUES (%s, %s, %s)
                """, (user_id, CLICK_REWARD, "clicker"))

                return jsonify({
                    "success": True,
                    "balance": new_balance,
                    "total_clicks": new_clicks,
                    "earned": CLICK_REWARD
                })

        except Exception as error:
            print("CLICKER ERROR:", type(error).__name__)
            return jsonify({
                "error": "Ошибка выполнения клика"
            }), 500

    return clicker_bp
