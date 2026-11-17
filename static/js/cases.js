
(() => {
    const app = window.NFT_CASE;

    if (!app) {
        console.error("NFT_CASE не найден");
        return;
    }

    const Cases = {
        list: [],
        currentCase: null,
        quantity: 1,

        async load() {
            const grid = document.getElementById("casesGrid");
            if (!grid) return;

            grid.innerHTML = '<div class="loading">Загрузка кейсов...</div>';

            try {
                const data = await app.request("/api/cases");

                if (!data.success) {
                    throw new Error(data.error || "Не удалось загрузить кейсы");
                }

                this.list = data.cases || [];
                this.render();
            } catch (error) {
                console.error(error);
                grid.innerHTML = '<div class="empty">Не удалось загрузить кейсы</div>';
            }
        },

        render() {
            const grid = document.getElementById("casesGrid");
            if (!grid) return;

            if (!this.list.length) {
                grid.innerHTML = '<div class="empty">Кейсов пока нет</div>';
                return;
            }

            grid.innerHTML = this.list.map(item => `
                <div class="case-card" data-code="${this.escape(item.code)}">
                    <div class="case-image">
                        ${item.image_url
                            ? `<img src="${this.escape(item.image_url)}" alt="">`
                            : '<div class="case-placeholder">🎁</div>'}
                    </div>
                    <div class="case-name">${this.escape(item.name)}</div>
                    <div class="case-price">${app.money(item.price)} G</div>
                    <button class="case-open-button" data-open="${this.escape(item.code)}">
                        Открыть
                    </button>
                </div>
            `).join("");

            grid.querySelectorAll("[data-open]").forEach(button => {
                button.addEventListener("click", () => {
                    this.openDetails(button.dataset.open);
                });
            });
        },

        async openDetails(code) {
            try {
                const data = await app.request(
                    "/api/cases/" + encodeURIComponent(code)
                );

                if (!data.success) {
                    throw new Error(data.error || "Ошибка загрузки кейса");
                }

                this.currentCase = data.case;
                this.quantity = 1;

                const items = data.items || [];

                const content = `
                    <div class="case-details">
                        <h2>${this.escape(data.case.name)}</h2>

                        <div class="case-placeholder big">🎁</div>

                        <div class="case-price">
                            Цена: ${app.money(data.case.price)} G
                        </div>

                        <h3>Содержимое кейса</h3>

                        <div class="case-items">
                            ${items.map(item => `
                                <div class="case-item">
                                    <div>${this.escape(item.name)}</div>
                                    <div>${app.money(item.base_price)} G</div>
                                    <div>${item.chance}%</div>
                                </div>
                            `).join("")}
                        </div>

                        <h3>Количество</h3>

                        <div class="quantity-controls">
                            <button id="caseMinus">−</button>
                            <span id="caseQuantity">1</span>
                            <button id="casePlus">+</button>
                        </div>

                        <div id="caseTotal">
                            Итого: ${app.money(data.case.price)} G
                        </div>

                        <button id="caseOpenConfirm">
                            Открыть кейс
                        </button>
                    </div>
                `;

                app.modal(content);

                document.getElementById("caseMinus").onclick = () => {
                    this.setQuantity(this.quantity - 1);
                };

                document.getElementById("casePlus").onclick = () => {
                    this.setQuantity(this.quantity + 1);
                };

                document.getElementById("caseOpenConfirm").onclick = () => {
                    this.open(code);
                };

            } catch (error) {
                app.notice(error.message, "error");
            }
        },

        setQuantity(value) {
            this.quantity = Math.max(1, Math.min(5, value));

            const quantity = document.getElementById("caseQuantity");
            const total = document.getElementById("caseTotal");

            if (quantity) {
                quantity.textContent = this.quantity;
            }

            if (total && this.currentCase) {
                total.textContent =
                    "Итого: " +
                    app.money(this.currentCase.price * this.quantity) +
                    " G";
            }
        },

        async open(code) {
            const button = document.getElementById("caseOpenConfirm");

            if (button) {
                button.disabled = true;
                button.textContent = "Открываем...";
            }

            try {
                const result = await app.request("/api/cases/open", {
                    method: "POST",
                    body: {
                        case_code: code,
                        quantity: this.quantity
                    }
                });

                if (!result.success) {
                    throw new Error(result.error || "Не удалось открыть кейс");
                }

                app.pendingBatch = result.batch_id;

                app.setBalance(result.balance);

                this.showResults(result);

            } catch (error) {
                app.notice(error.message, "error");

                if (button) {
                    button.disabled = false;
                    button.textContent = "Открыть кейс";
                }
            }
        },

        showResults(result) {
            const rewards = result.rewards || [];

            const content = `
                <div class="case-results">
                    <h2>Твои NFT</h2>
                    <p>Открыто кейсов: ${result.quantity}</p>

                    <div class="case-results-grid">
                        ${rewards.map(item => `
                            <div class="case-result-item">
                                ${item.image_url
                                    ? `<img src="${this.escape(item.image_url)}" alt="">`
                                    : '<div class="case-placeholder">🎁</div>'}

                                <div>${this.escape(item.name)}</div>

                                <div>${this.escape(item.background_name || "Normal")}</div>

                                <div>${app.money(item.price)} G</div>
                            </div>
                        `).join("")}
                    </div>

                    <button id="caseClaim">
                        Забрать все NFT
                    </button>

                    <button id="caseSell">
                        Продать всё за ${app.money(
                            rewards.reduce((sum, item) => sum + Number(item.price || 0), 0)
                        )} G
                    </button>

                    <button id="caseAgain">
                        Открыть ещё
                    </button>
                </div>
            `;

            app.modal(content);

            document.getElementById("caseClaim").onclick = () => {
                this.finishBatch("claim");
            };

            document.getElementById("caseSell").onclick = () => {
                this.finishBatch("sell");
            };

            document.getElementById("caseAgain").onclick = () => {
                app.closeModal();
                this.openDetails(this.currentCase.code);
            };
        },

        async finishBatch(action) {
            const batchId = app.pendingBatch;

            if (!batchId) {
                app.notice("Награды не найдены", "error");
                return;
            }

            try {
                const endpoint = action === "sell"
                    ? "/api/rewards/sell"
                    : "/api/rewards/claim";

                const result = await app.request(endpoint, {
                    method: "POST",
                    body: {
                        batch_id: batchId
                    }
                });

                if (!result.success) {
                    throw new Error(result.error || "Ошибка получения наград");
                }

                app.pendingBatch = null;
                app.closeModal();

                if (action === "sell") {
                    app.notice(
                        "Продано! Получено " + app.money(result.earned) + " G",
                        "success"
                    );
                } else {
                    app.notice("NFT добавлены в инвентарь", "success");
                }

                await app.refresh();

            } catch (error) {
                app.notice(error.message, "error");
            }
        },

        escape(value) {
            return String(value ?? "").replace(/[&<>"']/g, char => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#039;"
            })[char]);
        }
    };

    window.Cases = Cases;
})();
