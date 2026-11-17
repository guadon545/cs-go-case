
(() => {
    "use strict";

    const app = window.NFT_CASE;
    if (!app) return;

    const Upgrade = {
        inventory: [],
        catalog: [],
        busy: false,

        escape(value) {
            return String(value ?? "").replace(/[&<>"']/g, c => ({
                "&": "&amp;", "<": "&lt;", ">": "&gt;",
                '"': "&quot;", "'": "&#039;"
            })[c]);
        },

        sound(name) {
            window.GameSound?.play(name);
        },

        money(value) {
            return app.format(value);
        },

        mode() {
            return document.querySelector("#upgradeModes .selected")
                ?.dataset.mode || "multiplier";
        },

        multiplier() {
            return Number(
                document.querySelector("#multiplierTabs .selected")
                    ?.dataset.multiplier || 2
            );
        },

        source() {
            return this.inventory.find(
                item => String(item.inventory_id) ===
                    document.getElementById("upgradeSource")?.value
            );
        },

        backgroundMultiplier() {
            const select = document.getElementById("upgradeBackground");
            return {
                normal: 1,
                gold: 3,
                onyx_black: 5,
                black: 10
            }[select?.value || "normal"];
        },

        async load() {
            const sourceSelect = document.getElementById("upgradeSource");
            if (!sourceSelect) return;

            try {
                const data = await app.request("/api/upgrade/options");

                this.inventory = data.inventory || [];
                this.catalog = data.catalog || [];

                this.renderSources();
                this.bind();
                this.updateTargets();
            } catch (error) {
                sourceSelect.innerHTML =
                    '<option value="">Ошибка загрузки инвентаря</option>';
                app.notice(error.message || "Не удалось загрузить апгрейдер");
            }
        },

        renderSources() {
            const select = document.getElementById("upgradeSource");

            if (!this.inventory.length) {
                select.innerHTML =
                    '<option value="">Инвентарь пуст</option>';
                document.getElementById("upgradeTarget").innerHTML =
                    '<option value="">Нет доступных NFT</option>';
                document.getElementById("upgradeInfo").textContent =
                    "Сначала получи NFT из кейса";
                return;
            }

            select.innerHTML =
                '<option value="">Выбери свой NFT</option>' +
                this.inventory.map(item => `
                    <option value="${item.inventory_id}">
                        ${this.escape(item.name)} ·
                        ${this.money(item.final_price)}
                        · ${this.escape(item.background || "normal")}
                    </option>
                `).join("");
        },

        bind() {
            const modes = document.getElementById("upgradeModes");
            const multipliers = document.getElementById("multiplierTabs");

            if (modes && !modes.dataset.bound) {
                modes.dataset.bound = "1";
                modes.querySelectorAll("[data-mode]").forEach(button => {
                    button.addEventListener("click", () => {
                        this.sound("click");
                        modes.querySelectorAll("button")
                            .forEach(x => x.classList.remove("selected"));
                        button.classList.add("selected");

                        const percent = button.dataset.mode === "chance";
                        document.getElementById("multiplierTabs").style.display =
                            percent ? "none" : "flex";
                        document.getElementById("chanceControls").style.display =
                            percent ? "block" : "none";

                        this.updateTargets();
                    });
                });
            }

            if (multipliers && !multipliers.dataset.bound) {
                multipliers.dataset.bound = "1";

                multipliers.querySelectorAll("[data-multiplier]")
                    .forEach(button => {
                        button.addEventListener("click", () => {
                            this.sound("click");
                            multipliers.querySelectorAll("button")
                                .forEach(x => x.classList.remove("selected"));
                            button.classList.add("selected");
                            this.updateTargets();
                        });
                    });
            }

            ["upgradeSource", "upgradeBackground", "upgradeChance"]
                .forEach(id => {
                    const element = document.getElementById(id);
                    if (element && !element.dataset.bound) {
                        element.dataset.bound = "1";
                        element.addEventListener("change", () =>
                            this.updateTargets()
                        );
                        element.addEventListener("input", () =>
                            this.updateTargets()
                        );
                    }
                });

            const button = document.getElementById("upgradeButton");
            if (button && !button.dataset.bound) {
                button.dataset.bound = "1";
                button.addEventListener("click", () => this.perform());
            }
        },

        getChance() {
            const value = Number(
                document.getElementById("upgradeChance")?.value || 20
            );
            return Math.max(5, Math.min(90, value));
        },

        getTargetPriceRange(sourcePrice) {
            if (this.mode() === "multiplier") {
                const expected = sourcePrice * this.multiplier();
                return {
                    min: expected * 0.75,
                    max: expected * 1.25
                };
            }

            return {
                min: sourcePrice * 2,
                max: sourcePrice * 10
            };
        },

        updateTargets() {
            const source = this.source();
            const targetSelect = document.getElementById("upgradeTarget");
            const info = document.getElementById("upgradeInfo");

            if (!source) {
                targetSelect.innerHTML =
                    '<option value="">Сначала выбери исходный NFT</option>';
                info.textContent = "Выбери NFT для начала";
                return;
            }

            const sourcePrice = Number(source.final_price);
            const range = this.getTargetPriceRange(sourcePrice);
            const bgMultiplier = this.backgroundMultiplier();

            const targets = this.catalog.filter(item => {
                const price = Number(item.base_price) * bgMultiplier;
                return price >= range.min && price <= range.max;
            });

            targetSelect.innerHTML =
                '<option value="">Выбери награду</option>' +
                targets.map(item => `
                    <option value="${item.id}">
                        ${this.escape(item.name)} ·
                        ${this.money(Number(item.base_price) * bgMultiplier)}
                    </option>
                `).join("");

            const modeText = this.mode() === "multiplier"
                ? `Множитель x${this.multiplier()}`
                : `Шанс победы ${this.getChance()}%`;

            info.innerHTML = `
                Твой NFT: <b>${this.escape(source.name)}</b><br>
                Стоимость: <b>${this.money(sourcePrice)}</b><br>
                ${modeText}<br>
                Допустимая стоимость награды:
                <b>${this.money(range.min)} – ${this.money(range.max)}</b>
                <br>Подходящих NFT: <b>${targets.length}</b>
            `;

            if (!targets.length) {
                targetSelect.innerHTML =
                    '<option value="">Нет подходящих NFT</option>';
            }
        },

        async perform() {
            if (this.busy) return;

            const source = this.source();
            const targetId = document.getElementById("upgradeTarget").value;

            if (!source) {
                app.notice("Выбери NFT из инвентаря");
                return;
            }

            if (!targetId) {
                app.notice("Выбери NFT, который хочешь получить");
                return;
            }

            const mode = this.mode();
            const background =
                document.getElementById("upgradeBackground").value;

            const payload = {
                inventory_id: source.inventory_id,
                target_nft_id: Number(targetId),
                target_background: background,
                mode: mode === "chance" ? "percent" : "multiplier"
            };

            if (mode === "chance") {
                payload.chance = this.getChance();
            } else {
                payload.multiplier = this.multiplier();
            }

            this.busy = true;
            const button = document.getElementById("upgradeButton");
            button.disabled = true;

            this.sound("upgrade");
            this.showAnimation();

            try {
                const result = await app.request("/api/upgrade", {
                    method: "POST",
                    body: JSON.stringify(payload)
                });

                await new Promise(resolve => setTimeout(resolve, 1500));
                this.showResult(result);
            } catch (error) {
                app.closeModal();
                app.notice(error.message || "Ошибка апгрейда");
            } finally {
                this.busy = false;
                button.disabled = false;
            }
        },

        showAnimation() {
            app.showModal(`
                <style>
                    @keyframes upgradeSpin {
                        0% { transform: rotate(0) scale(.8); }
                        50% { transform: rotate(180deg) scale(1.12); }
                        100% { transform: rotate(360deg) scale(.8); }
                    }
                    @keyframes upgradeGlow {
                        0%,100% { box-shadow: 0 0 8px #8665f5; }
                        50% { box-shadow: 0 0 35px #8665f5; }
                    }
                    .upgrade-animation {
                        width:110px;height:110px;margin:30px auto;
                        border-radius:50%;
                        display:flex;align-items:center;justify-content:center;
                        font-size:48px;
                        background:linear-gradient(135deg,#8665f5,#397ce8);
                        animation:upgradeSpin 1.2s linear infinite,
                                  upgradeGlow 1s ease-in-out infinite;
                    }
                </style>
                <div style="text-align:center;padding:20px 5px">
                    <h2>АПГРЕЙД</h2>
                    <div class="upgrade-animation">⚡</div>
                    <h3>Проверяем результат...</h3>
                    <p class="muted small">Удача решает всё</p>
                </div>
            `);
        },

        showResult(result) {
            const won = !!result.won;
            const reward = result.reward;

            if (won) this.sound("win");
            else this.sound("lose");

            app.showModal(`
                <style>
                    @keyframes resultPop {
                        from {opacity:0;transform:scale(.65) translateY(20px)}
                        to {opacity:1;transform:scale(1) translateY(0)}
                    }
                    .upgrade-result {
                        text-align:center;
                        padding:18px 5px;
                        animation:resultPop .5s ease both;
                    }
                    .upgrade-result-art {
                        width:130px;height:130px;margin:20px auto;
                        border-radius:20px;
                        display:flex;align-items:center;justify-content:center;
                        background:linear-gradient(145deg,#7656d9,#244e9b);
                        overflow:hidden;font-size:48px;
                    }
                    .upgrade-result-art img {
                        width:100%;height:100%;object-fit:contain;
                    }
                </style>

                <div class="upgrade-result">
                    <h2 style="color:${won ? "#48d69a" : "#ff657c"}">
                        ${won ? "ПОБЕДА!" : "НЕУДАЧА"}
                    </h2>

                    ${won ? `
                        <div class="upgrade-result-art">
                            ${reward.image_url
                                ? `<img src="${this.escape(reward.image_url)}" alt="">`
                                : "🎁"}
                        </div>
                        <h3>${this.escape(reward.name)}</h3>
                        <p class="muted">
                            ${this.escape(reward.background)}
                        </p>
                        <h2 style="color:#bba8ff;margin:12px 0">
                            ${this.money(reward.price)}
                        </h2>
                        <p class="muted small">NFT добавлен в инвентарь</p>
                    ` : `
                        <div class="upgrade-result-art">💥</div>
                        <h3>Твой NFT сгорел</h3>
                        <p class="muted">
                            ${this.escape(result.lost?.name || "")}
                        </p>
                        <p class="muted small">
                            Попробуй ещё раз!
                        </p>
                    `}

                    <p class="muted small" style="margin:15px 0">
                        Шанс победы: ${result.chance}%
                    </p>

                    <button class="primary" id="upgradeResultClose">
                        ПРОДОЛЖИТЬ
                    </button>
                </div>
            `);

            document.getElementById("upgradeResultClose").onclick =
                async () => {
                    this.sound("click");
                    app.closeModal();
                    await app.refresh();
                    await this.load();
                };
        }
    };

    window.Upgrade = Upgrade;
    Upgrade.load();
})();
