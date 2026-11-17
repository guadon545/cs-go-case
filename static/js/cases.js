
(() => {
    const app = window.NFT_CASE;

    const Cases = {
        list: [],
        currentCase: null,
        quantity: 1,

        async load() {
            const grid = document.getElementById("casesGrid");
            if (!grid) return;

            try {
                const data = await app.request("/api/cases");
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
                <div class="case-card">
                    <div class="case-art">
                        ${item.image_url
                            ? `<img src="${this.escape(item.image_url)}" alt="">`
                            : "🎁"}
                    </div>
                    <div class="case-name">${this.escape(item.name)}</div>
                    <div class="case-price">${app.format(item.price)}</div>
                    <button class="card-button" data-open="${this.escape(item.code)}">
                        Открыть кейс
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

                this.currentCase = data.case;
                this.quantity = 1;

                const items = data.items || [];

                const html = `
                    <h2>${this.escape(data.case.name)}</h2>
                    <div class="case-art" style="height:130px;font-size:55px">🎁</div>

                    <p class="muted">Цена: ${app.format(data.case.price)}</p>

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
                    this.setQuantity(this.quantity - 1);
                };

                document.getElementById("casePlus").onclick = () => {
                    this.setQuantity(this.quantity + 1);
                };

                document.getElementById("caseOpenConfirm").onclick = () => {
                    this.open(code);
                };

            } catch (error) {
                app.notice(error.message);
            }
        },

        setQuantity(value) {
            this.quantity = Math.max(1, Math.min(5, value));

            document.getElementById("caseQuantity").textContent =
                this.quantity;

            document.getElementById("caseTotal").textContent =
                "Итого: " + app.format(
                    this.currentCase.price * this.quantity
                );
        },

        async open(code) {
            const button = document.getElementById("caseOpenConfirm");
            button.disabled = true;
            button.textContent = "Открываем...";

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
                if (balance) balance.textContent = app.format(result.balance);

                this.showResults(result);

            } catch (error) {
                app.notice(error.message);
                button.disabled = false;
                button.textContent = "ОТКРЫТЬ";
            }
        },

        showResults(result) {
            const rewards = result.rewards || [];

            const total = rewards.reduce(
                (sum, item) => sum + Number(item.price || 0), 0
            );

            const html = `
                <h2 style="margin-bottom:10px">Твои NFT!</h2>
                <p class="muted small">Открыто кейсов: ${result.quantity}</p>

                <div class="grid" style="margin:15px 0">
                    ${rewards.map(item => `
                        <div class="nft-card">
                            <div class="nft-art">
                                ${item.image_url
                                    ? `<img src="${this.escape(item.image_url)}" alt="">`
                                    : "🎁"}
                            </div>
                            <div class="nft-name">${this.escape(item.name)}</div>
                            <div class="small muted">
                                ${this.escape(item.background_name || "Normal")}
                            </div>
                            <div class="nft-price">${app.format(item.price)}</div>
                        </div>
                    `).join("")}
                </div>

                <button class="primary" id="caseClaim">
                    ЗАБРАТЬ ВСЁ
                </button>

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
                    app.notice("Продано! Получено " + app.format(result.earned));
                } else {
                    app.notice("NFT добавлены в инвентарь");
                }

                await app.refresh();

            } catch (error) {
                app.notice(error.message);
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
