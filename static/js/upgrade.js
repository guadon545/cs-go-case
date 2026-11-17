
(() => {
    "use strict";

    const app = window.NFT_CASE;

    if (!app) {
        console.error("NFT_CASE не найден");
        return;
    }

    const Cases = {
        list: [],
        currentCase: null,
        quantity: 1,
        opening: false,

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

        async load() {
            const grid = document.getElementById("casesGrid");
            if (!grid) return;

            try {
                const data = await app.request("/api/cases");
                this.list = data.cases || [];
                this.render();
            } catch (error) {
                console.error("Ошибка загрузки кейсов:", error);
                grid.innerHTML =
                    '<div class="empty">Не удалось загрузить кейсы</div>';
            }
        },

        render() {
            const grid = document.getElementById("casesGrid");
            if (!grid) return;

            if (!this.list.length) {
                grid.innerHTML =
                    '<div class="empty">Кейсов пока нет</div>';
                return;
            }

            grid.innerHTML = this.list.map(item => `
                <div class="case-card">
                    <div class="case-art">
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
            `).join("");

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
                        style="height:130px;font-size:55px">
                        🎁
                    </div>

                    <p class="muted">
                        Цена: ${app.format(data.case.price)}
                    </p>

                    <hr>
                    <h3>Содержимое кейса</h3>

                    ${items.map(item => `
                        <div class="result-item">
                            <b>${this.escape(item.name)}</b>
                            <div class="muted small">
                                Цена: ${app.format(item.base_price)}
                                · Шанс: ${item.chance}%
                            </div>
                        </div>
                    `).join("")}

                    <hr>

                    <div class="row">
                        <button class="secondary" id="caseMinus">−</button>
                        <b id="caseQuantity">1</b>
                        <button class="secondary" id="casePlus">+</button>
                    </div>

                    <p id="caseTotal" style="margin:15px 0">
                        Итого: ${app.format(data.case.price)}
                    </p>

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
                    @keyframes caseFlip {
                        0% { transform: rotateY(0) scale(.85); }
                        50% { transform: rotateY(180deg) scale(1.12); }
                        100% { transform: rotateY(360deg) scale(.85); }
                    }

                    @keyframes caseGlow {
                        0%,100% {
                            box-shadow: 0 0 10px #9270ff44;
                        }
                        50% {
                            box-shadow: 0 0 35px #9270ffcc;
                        }
                    }

                    @keyframes caseText {
                        0%,100% { opacity:.5; }
                        50% { opacity:1; }
                    }

                    .case-opening-card {
                        width:75px;
                        height:95px;
                        border-radius:15px;
                        display:flex;
                        align-items:center;
                        justify-content:center;
                        font-size:38px;
                        background:linear-gradient(145deg,#7554d9,#244e9b);
                        border:1px solid #bbaaff;
                        animation:caseFlip 1s ease-in-out infinite,
                                  caseGlow 1s ease-in-out infinite;
                    }

                    .case-opening-card:nth-child(2) {
                        animation-delay:.15s;
                    }

                    .case-opening-card:nth-child(3) {
                        animation-delay:.3s;
                    }

                    .case-opening-text {
                        animation:caseText 1s ease-in-out infinite;
                    }
                </style>

                <div style="clear:both;text-align:center;padding:30px 5px">
                    <h2 style="margin-bottom:25px">Открываем кейс</h2>

                    <div style="display:flex;justify-content:center;gap:9px">
                        <div class="case-opening-card">🎁</div>
                        <div class="case-opening-card">🎁</div>
                        <div class="case-opening-card">🎁</div>
                    </div>

                    <h3 class="case-opening-text"
                        style="margin-top:28px;color:#bbaaff">
                        Ищем твой NFT...
                    </h3>
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

                await this.wait(1300);

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
                        from {
                            opacity:0;
                            transform:translateY(25px) scale(.8);
                        }
                        to {
                            opacity:1;
                            transform:translateY(0) scale(1);
                        }
                    }

                    .case-reward {
                        animation:rewardAppear .45s ease both;
                    }

                    .case-reward:nth-child(2) {animation-delay:.1s}
                    .case-reward:nth-child(3) {animation-delay:.2s}
                    .case-reward:nth-child(4) {animation-delay:.3s}
                    .case-reward:nth-child(5) {animation-delay:.4s}
                </style>

                <h2 style="margin-bottom:10px">Твои NFT!</h2>

                <p class="muted small">
                    Открыто кейсов: ${result.quantity}
                </p>

                <div class="grid" style="margin:15px 0">
                    ${rewards.map(item => `
                        <div class="nft-card case-reward">
                            <div class="nft-art">
                                ${item.image_url
                                    ? `<img src="${this.escape(item.image_url)}" alt="">`
                                    : "🎁"}
                            </div>

                            <div class="nft-name">
                                ${this.escape(item.name)}
                            </div>

                            <div class="small muted">
                                ${this.escape(
                                    item.background_name || "Обычный"
                                )}
                            </div>

                            <div class="nft-price">
                                ${app.format(item.price)}
                            </div>
                        </div>
                    `).join("")}
                </div>

                <button class="primary" id="caseClaim">
                    ЗАБРАТЬ ВСЁ
                </button>

                <button class="primary" id="caseSell"
                    style="margin-top:9px">
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
                app.closeModal();
                this.openDetails(this.currentCase.code);
            };
        },

        async finishBatch(action) {
            if (!app.pendingBatch) {
                app.notice("Награды не найдены");
                return;
            }

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
                    app.notice(
                        "Продано! Получено " + app.format(result.earned)
                    );
                } else {
                    app.notice("NFT добавлены в инвентарь");
                }

                await app.refresh();

            } catch (error) {
                app.notice(error.message || "Ошибка обработки наград");
            }
        },

        init() {
            this.load();
        }
    };

    window.Cases = Cases;
    Cases.init();
})();
