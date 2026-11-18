
(() => {
    "use strict";

    const app = window.NFT_CASE;

    if (!app) {
        console.error("[CASES] NFT_CASE не найден");
        return;
    }

    const Cases = {
        list: [],
        currentCase: null,
        quantity: 1,
        opening: false,
        loading: false,
        diagnostic: "Скрипт кейсов запущен",

        sound(name) {
            window.GameSound?.play(name);
        },

        wait(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        escape(value) {
            return String(value ?? "").replace(/[&<>"']/g, char => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#039;"
            })[char]);
        },

        showDiagnostic(message, error = false) {
            this.diagnostic = message;
            console.log("[CASES]", message);

            const grid = document.getElementById("casesGrid");
            if (!grid) return;

            let panel = document.getElementById("casesDiagnostic");

            if (!panel) {
                panel = document.createElement("div");
                panel.id = "casesDiagnostic";
                panel.style.cssText = `
                    grid-column:1/-1;
                    padding:12px;
                    margin-bottom:10px;
                    border:1px solid rgba(255,255,255,.15);
                    border-radius:12px;
                    background:rgba(255,255,255,.06);
                    color:#ddd;
                    font-size:12px;
                    overflow-wrap:anywhere;
                `;
                grid.prepend(panel);
            }

            panel.style.color = error ? "#ff8294" : "#b9a8ff";
            panel.textContent = "Диагностика: " + message;
        },

        async load() {
            const grid = document.getElementById("casesGrid");

            if (!grid) {
                console.error("[CASES] Не найден casesGrid");
                return;
            }

            if (this.loading) {
                console.log("[CASES] Загрузка уже выполняется");
                return;
            }

            this.loading = true;

            this.showDiagnostic("Скрипт запущен. Проверяем Telegram...");

            const tg = window.Telegram?.WebApp;
            const initData = tg?.initData || "";

            this.showDiagnostic(
                initData
                    ? "Telegram найден, initData получен. Отправляем запрос..."
                    : "ВНИМАНИЕ: Telegram initData отсутствует"
            );

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);

            try {
                console.log("[CASES] Отправляем GET /api/cases");

                const headers = {
                    "Content-Type": "application/json"
                };

                if (initData) {
                    headers["X-Telegram-Init-Data"] = initData;
                }

                const response = await fetch("/api/cases", {
                    method: "GET",
                    headers,
                    signal: controller.signal,
                    cache: "no-store"
                });

                this.showDiagnostic(
                    "Сервер ответил. HTTP " + response.status
                );

                console.log("[CASES] HTTP:", response.status);

                const data = await response.json();

                if (!response.ok || data.success === false) {
                    throw new Error(
                        data.error ||
                        data.message ||
                        "Ошибка HTTP " + response.status
                    );
                }

                this.list = Array.isArray(data.cases)
                    ? data.cases
                    : [];

                this.render();

                this.showDiagnostic(
                    "Успешно! Получено кейсов: " + this.list.length
                );

                console.log("[CASES] Загружено кейсов:", this.list.length);

            } catch (error) {
                console.error("[CASES] Ошибка:", error);

                let message = error.message || "Неизвестная ошибка";

                if (error.name === "AbortError") {
                    message = "Сервер не ответил за 15 секунд";
                }

                this.showDiagnostic(
                    "ОШИБКА: " + message,
                    true
                );

                grid.innerHTML = `
                    <div class="empty" style="grid-column:1/-1">
                        <b>Не удалось загрузить кейсы</b>
                        <p style="margin-top:10px;overflow-wrap:anywhere">
                            ${this.escape(message)}
                        </p>
                        <button class="card-button"
                            id="casesRetry"
                            style="margin-top:15px">
                            ПОПРОБОВАТЬ ЕЩЁ РАЗ
                        </button>
                    </div>
                `;

                const retry = document.getElementById("casesRetry");

                if (retry) {
                    retry.onclick = () => this.load();
                }

            } finally {
                clearTimeout(timeout);
                this.loading = false;
            }
        },

        render() {
            const grid = document.getElementById("casesGrid");
            if (!grid) return;

            if (!this.list.length) {
                grid.innerHTML = `
                    <div class="empty" style="grid-column:1/-1">
                        Кейсов пока нет
                    </div>
                `;
                return;
            }

            grid.innerHTML = this.list.map((item, index) => {
                const isFeatured = index === this.list.length - 1;

                return `
                    <div class="case-card"
                        style="${isFeatured ? "grid-column:1/-1" : ""}">

                        <div class="case-art"
                            style="${isFeatured ? "height:145px;font-size:58px" : ""}">
                            ${item.image_url
                                ? `<img src="${this.escape(item.image_url)}" alt="">`
                                : "🎁"}
                        </div>

                        <div class="case-name">
                            ${this.escape(item.name)}
                        </div>

                        <div class="case-price">
                            ${app.format(item.price)}
                        </div>

                        <button class="card-button"
                            data-open="${this.escape(item.code)}">
                            Открыть кейс
                        </button>
                    </div>
                `;
            }).join("");

            grid.querySelectorAll("[data-open]").forEach(button => {
                button.addEventListener("click", () => {
                    this.sound("click");
                    this.openDetails(button.dataset.open);
                });
            });
        },

        async openDetails(code) {
            try {
                const data = await app.request(
                    "/api/cases/" + encodeURIComponent(code)
                );

                this.currentCase = data.case;
                this.quantity = 1;

                const items = data.items || [];

                const html = `
                    <h2>${this.escape(data.case.name)}</h2>

                    <div class="case-art"
                        style="height:145px;font-size:58px">
                        🎁
                    </div>

                    <p class="muted">
                        Цена за один кейс:
                        <b>${app.format(data.case.price)}</b>
                    </p>

                    <hr>

                    <h3>Содержимое кейса</h3>

                    <div class="case-contents">
                        ${items.map(item => `
                            <div class="result-item">
                                <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
                                    <b>${this.escape(item.name)}</b>
                                    <span class="small">${item.chance}%</span>
                                </div>

                                <div class="muted small">
                                    ${this.escape(item.rarity || "")}
                                    · Цена: ${app.format(item.base_price)}
                                </div>
                            </div>
                        `).join("")}
                    </div>

                    <hr>

                    <h3>Количество кейсов</h3>

                    <div class="row"
                        style="justify-content:center;align-items:center;gap:22px;margin:14px 0">

                        <button class="secondary" id="caseMinus"
                            style="min-width:48px">−</button>

                        <b id="caseQuantity"
                            style="font-size:24px;min-width:30px;text-align:center">1</b>

                        <button class="secondary" id="casePlus"
                            style="min-width:48px">+</button>
                    </div>

                    <div id="caseTotal"
                        style="text-align:center;font-size:18px;margin:15px 0">
                        Итого: ${app.format(data.case.price)}
                    </div>

                    <button class="primary" id="caseOpenConfirm">
                        ОТКРЫТЬ
                    </button>
                `;

                app.showModal(html);

                document.getElementById("caseMinus").onclick = () => {
                    this.sound("click");
                    this.setQuantity(this.quantity - 1);
                };

                document.getElementById("casePlus").onclick = () => {
                    this.sound("click");
                    this.setQuantity(this.quantity + 1);
                };

                document.getElementById("caseOpenConfirm").onclick = () => {
                    this.open(code);
                };

            } catch (error) {
                app.notice(error.message || "Ошибка загрузки кейса");
            }
        },

        setQuantity(value) {
            this.quantity = Math.max(1, Math.min(5, value));

            const quantity = document.getElementById("caseQuantity");
            const total = document.getElementById("caseTotal");

            if (quantity) {
                quantity.textContent = this.quantity;
            }

            if (total) {
                total.textContent =
                    "Итого: " + app.format(
                        this.currentCase.price * this.quantity
                    );
            }
        },

        showOpening() {
            app.showModal(`
                <style>
                    @keyframes chestFloat {
                        0%,100% { transform:translateY(5px) rotate(-2deg); }
                        50% { transform:translateY(-10px) rotate(2deg); }
                    }
                    @keyframes lidOpen {
                        0%,35% { transform:rotate(0deg); }
                        65%,100% { transform:rotate(-38deg) translateY(-7px); }
                    }
                    @keyframes chestGlow {
                        0%,100% { filter:drop-shadow(0 0 8px #8968ff66); }
                        50% { filter:drop-shadow(0 0 30px #b99aff); }
                    }
                    @keyframes beam {
                        0%,45% { opacity:0; transform:scaleY(.1); }
                        70% { opacity:1; transform:scaleY(1); }
                        100% { opacity:0; transform:scaleY(1.15); }
                    }
                    @keyframes sparkle {
                        0%,100% { opacity:.15; transform:scale(.5) rotate(0); }
                        50% { opacity:1; transform:scale(1.25) rotate(90deg); }
                    }
                    @keyframes loadingPulse {
                        0%,100% { opacity:.45; }
                        50% { opacity:1; }
                    }
                    @keyframes caseProgress {
                        0% { width:5%; margin-left:0; }
                        65% { width:70%; margin-left:15%; }
                        100% { width:100%; margin-left:0; }
                    }
                    .case-opening-stage {
                        position:relative;height:220px;display:flex;
                        align-items:center;justify-content:center;overflow:hidden;
                    }
                    .case-opening-chest {
                        position:relative;width:150px;height:105px;
                        animation:chestFloat 1.5s ease-in-out infinite,
                        chestGlow 1.5s ease-in-out infinite;z-index:2;
                    }
                    .case-chest-base {
                        position:absolute;bottom:0;left:8px;width:134px;height:70px;
                        border:3px solid #f1c879;border-radius:12px 12px 17px 17px;
                        background:linear-gradient(145deg,#a65b27,#633016);
                        box-shadow:inset 0 8px 15px #ffffff22,0 12px 25px #0008;
                    }
                    .case-chest-base:before {
                        content:"";position:absolute;left:55px;top:0;width:19px;height:100%;
                        background:linear-gradient(90deg,#d49b43,#ffe4a0,#a96a27);
                    }
                    .case-chest-lid {
                        position:absolute;top:13px;left:5px;width:140px;height:42px;
                        border:3px solid #f1c879;border-radius:13px 13px 5px 5px;
                        background:linear-gradient(145deg,#d18a3e,#81401d);
                        transform-origin:12px 38px;animation:lidOpen 2.6s ease-in-out infinite;z-index:3;
                    }
                    .case-chest-lock {
                        position:absolute;z-index:4;left:65px;top:56px;width:22px;height:27px;
                        border:2px solid #ffe2a0;border-radius:6px;
                        background:linear-gradient(#f5d17c,#a96a27);
                    }
                    .case-opening-beam {
                        position:absolute;bottom:54px;width:100px;height:150px;
                        background:linear-gradient(transparent,#c5a5ff99,transparent);
                        filter:blur(13px);transform-origin:bottom;
                        animation:beam 2.6s ease-in-out infinite;z-index:1;
                    }
                    .case-spark {
                        position:absolute;color:#e2ccff;font-size:24px;
                        animation:sparkle 1.2s ease-in-out infinite;
                    }
                    .case-spark.s1 {top:28px;left:18%}
                    .case-spark.s2 {top:55px;right:17%;animation-delay:.3s}
                    .case-spark.s3 {bottom:30px;left:25%;animation-delay:.6s}
                    .case-spark.s4 {bottom:40px;right:25%;animation-delay:.9s}
                    .case-opening-text {animation:loadingPulse 1s ease-in-out infinite}
                </style>

                <div style="text-align:center;padding:15px 5px">
                    <h2 style="margin-bottom:4px">Открываем кейс</h2>
                    <div class="case-opening-stage">
                        <div class="case-opening-beam"></div>
                        <span class="case-spark s1">✦</span>
                        <span class="case-spark s2">✧</span>
                        <span class="case-spark s3">✦</span>
                        <span class="case-spark s4">✧</span>
                        <div class="case-opening-chest">
                            <div class="case-chest-lid"></div>
                            <div class="case-chest-base"></div>
                            <div class="case-chest-lock"></div>
                        </div>
                    </div>
                    <h3 class="case-opening-text"
                        style="margin-top:5px;color:#cbb4ff">
                        Ищем твой NFT...
                    </h3>
                    <div style="height:4px;background:#ffffff18;border-radius:9px;overflow:hidden;margin:18px 20px">
                        <div style="height:100%;width:45%;border-radius:9px;background:linear-gradient(90deg,#8058db,#d6baff);animation:caseProgress 2.6s ease-in-out infinite"></div>
                    </div>
                </div>
            `);
        },

        async open(code) {
            if (this.opening) return;

            const button = document.getElementById("caseOpenConfirm");
            if (!button) return;

            this.opening = true;
            button.disabled = true;
            button.textContent = "ОТКРЫВАЕМ...";

            this.sound("open");
            this.showOpening();

            try {
                const result = await app.request("/api/cases/open", {
                    method: "POST",
                    body: JSON.stringify({
                        case_code: code,
                        quantity: this.quantity
                    })
                });

                app.pendingBatch = result.batch_id;

                const balance = document.getElementById("balance");

                if (balance && result.balance !== undefined) {
                    balance.textContent = app.format(result.balance);
                }

                await this.wait(2600);
                this.showResults(result);

            } catch (error) {
                app.closeModal();
                app.notice(error.message || "Ошибка открытия кейса");
            } finally {
                this.opening = false;
            }
        },

        showResults(result) {
            const rewards = result.rewards || [];

            const total = rewards.reduce(
                (sum, item) => sum + Number(item.price || 0),
                0
            );

            this.sound("win");

            const html = `
                <style>
                    @keyframes rewardAppear {
                        from {opacity:0;transform:translateY(25px) scale(.8)}
                        to {opacity:1;transform:translateY(0) scale(1)}
                    }
                    .case-reward {animation:rewardAppear .45s ease both}
                    .case-reward:nth-child(2) {animation-delay:.1s}
                    .case-reward:nth-child(3) {animation-delay:.2s}
                    .case-reward:nth-child(4) {animation-delay:.3s}
                    .case-reward:nth-child(5) {animation-delay:.4s}
                </style>

                <h2 style="margin-bottom:10px">Твои NFT!</h2>
                <p class="muted small">Открыто кейсов: ${result.quantity}</p>

                <div class="grid" style="margin:15px 0">
                    ${rewards.map(item => `
                        <div class="nft-card case-reward">
                            <div class="nft-art">
                                ${item.image_url
                                    ? `<img src="${this.escape(item.image_url)}" alt="">`
                                    : "🎁"}
                            </div>
                            <div class="nft-name">${this.escape(item.name)}</div>
                            <div class="small muted">
                                ${this.escape(item.background_name || "Обычный")}
                            </div>
                            <div class="nft-price">${app.format(item.price)}</div>
                        </div>
                    `).join("")}
                </div>

                <button class="primary" id="caseClaim">ЗАБРАТЬ ВСЁ</button>
                <button class="primary" id="caseSell" style="margin-top:9px">
                    ПРОДАТЬ ВСЁ · ${app.format(total)}
                </button>
                <button class="secondary" id="caseAgain"
                    style="width:100%;margin-top:9px">
                    ОТКРЫТЬ ЕЩЁ
                </button>
            `;

            app.showModal(html);

            document.getElementById("caseClaim").onclick = () => {
                this.sound("click");
                this.finishBatch("claim");
            };

            document.getElementById("caseSell").onclick = () => {
                this.sound("click");
                this.finishBatch("sell");
            };

            document.getElementById("caseAgain").onclick = () => {
                this.sound("click");
                this.finishBatch("claim", true);
            };
        },

        async finishBatch(action, reopen = false) {
            if (!app.pendingBatch) {
                app.notice("Награды не найдены");
                return;
            }

            const caseCode = this.currentCase?.code;

            try {
                const endpoint = action === "sell"
                    ? "/api/rewards/sell"
                    : "/api/rewards/claim";

                const result = await app.request(endpoint, {
                    method: "POST",
                    body: JSON.stringify({
                        batch_id: app.pendingBatch
                    })
                });

                app.pendingBatch = null;
                app.closeModal();

                if (action === "sell") {
                    app.notice("Продано! Получено " + app.format(result.earned));
                } else if (!reopen) {
                    app.notice("NFT добавлены в инвентарь");
                }

                await app.refresh();

                if (reopen && caseCode) {
                    await this.openDetails(caseCode);
                }

            } catch (error) {
                app.notice(error.message || "Ошибка обработки наград");
            }
        },

        init() {
            console.log("[CASES] Инициализация модуля");
            this.load();
        }
    };

    window.Cases = Cases;
    Cases.init();
})();
