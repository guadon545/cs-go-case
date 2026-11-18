
(() => {
    "use strict";

    const app = window.NFT_CASE;

    if (!app) {
        console.error("NFT_CASE не найден");
        return;
    }

    const Profile = {
        loaded: false,
        loading: false,

        escape(value) {
            return String(value ?? "").replace(/[&<>"']/g, char => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#039;"
            })[char]);
        },

        backgroundName(background) {
            const names = {
                normal: "Normal",
                gold: "Gold",
                onyx_black: "Onyx Black",
                black: "Black"
            };

            return names[background] || "Normal";
        },

        async load() {
            if (this.loading) return;

            this.loading = true;

            try {
                const [profileData, inventoryData] = await Promise.all([
                    app.request("/api/profile"),
                    app.request("/api/inventory")
                ]);

                const profile = profileData.profile || {};
                const inventory = inventoryData.inventory || [];

                app.profile = profile;
                app.inventory = inventory;

                this.renderProfile(profile);
                this.renderInventory(inventory);
                this.renderStats(profile, inventory);

                this.loaded = true;

            } catch (error) {
                console.error("Ошибка загрузки профиля:", error);
                app.notice(error.message || "Не удалось загрузить профиль");

            } finally {
                this.loading = false;
            }
        },

        renderProfile(profile) {
            const name = profile.first_name ||
                profile.username ||
                "Игрок";

            const nameElement = document.getElementById("profileName");
            const idElement = document.getElementById("profileGameId");
            const balanceElement = document.getElementById("profileBalance");
            const mainBalance = document.getElementById("balance");
            const avatar = document.getElementById("profileAvatar");
            const soundSwitch = document.getElementById("soundSwitch");

            if (nameElement) nameElement.textContent = name;

            if (idElement) {
                idElement.textContent = profile.game_id || "#-----";
            }

            if (balanceElement) {
                balanceElement.textContent = app.format(profile.balance);
            }

            if (mainBalance) {
                mainBalance.textContent = app.format(profile.balance);
            }

            if (avatar) {
                avatar.textContent =
                    name.trim().charAt(0).toUpperCase() || "N";
            }

            const sound = profile.sound_enabled !== false;
            app.sound = sound;

            if (soundSwitch) {
                soundSwitch.classList.toggle("on", sound);
            }
        },

        renderStats(profile, inventory) {
            const stats = profile.stats || {};

            const values = {
                statCases: stats.cases_opened || 0,
                statUpgrades: stats.upgrades_played || 0,
                statWins: stats.upgrades_won || 0,
                statCrafts: stats.crafts_completed || 0,
                statSold: stats.nft_sold || 0,
                statInventory: inventory.length
            };

            Object.entries(values).forEach(([id, value]) => {
                const element = document.getElementById(id);

                if (element) {
                    element.textContent = value;
                }
            });
        },

        renderInventory(inventory) {
            const container = document.getElementById("inventoryGrid");

            if (!container) return;

            if (!inventory.length) {
                container.innerHTML = `
                    <div class="empty" style="grid-column:1/-1">
                        У тебя пока нет NFT.<br>
                        Открой первый кейс!
                    </div>
                `;
                return;
            }

            const sorted = [...inventory].sort((a, b) =>
                Number(b.final_price || 0) -
                Number(a.final_price || 0)
            );

            container.innerHTML = sorted.map(item => {
                const id = Number(item.inventory_id);
                const name = this.escape(
                    item.name || item.code || "NFT"
                );

                const background = this.backgroundName(item.background);
                const price = app.format(item.final_price);

                const image = item.image_url
                    ? `<img src="${this.escape(item.image_url)}"
                         alt="${name}" loading="lazy">`
                    : "🎁";

                return `
                    <div class="nft-card">
                        <div class="nft-art">${image}</div>

                        <div class="nft-name">${name}</div>

                        <div class="muted small">
                            ${background}
                        </div>

                        <div class="nft-price">${price}</div>

                        <button class="card-button"
                            data-inventory-id="${id}">
                            Подробнее
                        </button>
                    </div>
                `;
            }).join("");

            container.querySelectorAll("[data-inventory-id]")
                .forEach(button => {
                    button.addEventListener("click", () => {
                        const id = Number(button.dataset.inventoryId);

                        const item = inventory.find(x =>
                            Number(x.inventory_id) === id
                        );

                        if (item) {
                            this.showItem(item);
                        }
                    });
                });
        },

        showItem(item) {
            const name = this.escape(
                item.name || item.code || "NFT"
            );

            const background = this.backgroundName(item.background);
            const price = app.format(item.final_price);

            const image = item.image_url
                ? `<img src="${this.escape(item.image_url)}"
                     style="width:100%;height:180px;object-fit:contain">`
                : `<div style="font-size:75px;text-align:center;padding:30px">
                     🎁
                   </div>`;

            app.showModal(`
                <div style="clear:both;padding-top:15px">
                    ${image}

                    <h2 style="text-align:center;margin:12px 0">
                        ${name}
                    </h2>

                    <div class="result-item">
                        <div class="row">
                            <span class="muted">Фон</span>
                            <strong>${background}</strong>
                        </div>
                    </div>

                    <div class="result-item">
                        <div class="row">
                            <span class="muted">Стоимость</span>
                            <strong>${price}</strong>
                        </div>
                    </div>

                    <div class="result-item">
                        <div class="row">
                            <span class="muted">ID предмета</span>
                            <strong>#${Number(item.inventory_id)}</strong>
                        </div>
                    </div>

                    <button class="primary"
                        id="sellOneNft"
                        style="margin-top:12px">
                        ПРОДАТЬ ЗА ${price}
                    </button>
                </div>
            `);

            document.getElementById("sellOneNft").onclick =
                async () => {
                    if (!confirm(`Продать ${name} за ${price}?`)) {
                        return;
                    }

                    const button = document.getElementById("sellOneNft");

                    if (button) {
                        button.disabled = true;
                        button.textContent = "ПРОДАЁМ...";
                    }

                    try {
                        const result = await app.request(
                            "/api/skins/sell",
                            {
                                method: "POST",
                                body: JSON.stringify({
                                    inventory_id: Number(item.inventory_id)
                                })
                            }
                        );

                        app.closeModal();

                        app.notice(
                            `NFT продан. Получено ${app.format(result.earned)}`
                        );

                        await app.refresh();

                    } catch (error) {
                        app.notice(error.message || "Ошибка продажи NFT");

                        if (button) {
                            button.disabled = false;
                            button.textContent = `ПРОДАТЬ ЗА ${price}`;
                        }
                    }
                };
        },

        async sellAll() {
            if (!app.inventory || !app.inventory.length) {
                app.notice("Инвентарь пуст");
                return;
            }

            const count = app.inventory.length;

            if (!confirm(`Продать все NFT (${count} шт.)?`)) {
                return;
            }

            try {
                const result = await app.request(
                    "/api/inventory/sell-all",
                    {
                        method: "POST",
                        body: JSON.stringify({})
                    }
                );

                app.notice(
                    `Продано NFT: ${result.sold}. Получено: ${app.format(result.earned)}`
                );

                await app.refresh();

            } catch (error) {
                app.notice(error.message || "Ошибка продажи NFT");
            }
        },

        async setSound() {
            const next = !app.sound;
            const button = document.getElementById("soundSwitch");

            if (button) button.disabled = true;

            try {
                await app.request("/api/profile/settings", {
                    method: "POST",
                    body: JSON.stringify({
                        sound_enabled: next
                    })
                });

                app.sound = next;

                if (button) {
                    button.classList.toggle("on", next);
                }

                app.notice(
                    next ? "Звуки включены" : "Звуки выключены"
                );

                if (next) {
                    window.GameSound?.unlock();
                    window.GameSound?.play("click");
                }

            } catch (error) {
                app.notice(
                    error.message || "Не удалось изменить настройки звука"
                );

            } finally {
                if (button) button.disabled = false;
            }
        },

        toggleAdmin() {
            if (!app.admin) {
                app.notice("Нет доступа к админ-панели");
                return;
            }

            const enabled =
                localStorage.getItem("nft_show_admin") !== "1";

            localStorage.setItem(
                "nft_show_admin",
                enabled ? "1" : "0"
            );

            const switchButton =
                document.getElementById("adminSwitch");

            const navButton =
                document.getElementById("adminNav");

            if (switchButton) {
                switchButton.classList.toggle("on", enabled);
            }

            if (navButton) {
                navButton.style.display = enabled ? "flex" : "none";
            }

            const adminPage = document.getElementById("page-admin");

            if (
                !enabled &&
                adminPage &&
                adminPage.classList.contains("active")
            ) {
                app.navigate("profile");
            }

            app.notice(
                enabled
                    ? "Вкладка администратора включена"
                    : "Вкладка администратора скрыта"
            );
        },

        async adminAction(action) {
            if (!app.admin) {
                app.notice("Нет доступа");
                return;
            }

            const gameId = document
                .getElementById("adminGameId")
                .value.trim();

            const amount = Number(
                document.getElementById("adminAmount").value
            );

            if (!gameId) {
                app.notice("Введи игровой ID");
                return;
            }

            if (!Number.isSafeInteger(amount) || amount <= 0) {
                app.notice("Введи целое положительное количество G");
                return;
            }

            const endpoint = action === "give"
                ? "/api/admin/give-g"
                : "/api/admin/take-g";

            try {
                const result = await app.request(endpoint, {
                    method: "POST",
                    body: JSON.stringify({
                        game_id: gameId,
                        amount
                    })
                });

                app.notice(
                    action === "give"
                        ? "G успешно выданы"
                        : "G успешно забраны"
                );

                document.getElementById("adminAmount").value = "";

                if (result.balance !== undefined) {
                    app.notice(
                        `Операция выполнена. Новый баланс игрока: ${app.format(result.balance)}`
                    );
                }

                await this.load();

            } catch (error) {
                app.notice(error.message || "Ошибка операции");
            }
        },

        async giveNft() {
            if (!app.admin) {
                app.notice("Нет доступа");
                return;
            }

            const gameId = document
                .getElementById("adminGameId")
                .value.trim();

            const code = document
                .getElementById("adminNftCode")
                .value.trim();

            const background = document
                .getElementById("adminBackground")
                .value;

            if (!gameId || !code) {
                app.notice("Заполни игровой ID и код NFT");
                return;
            }

            try {
                await app.request("/api/admin/give-nft", {
                    method: "POST",
                    body: JSON.stringify({
                        game_id: gameId,
                        nft_code: code,
                        background
                    })
                });

                app.notice("NFT успешно выдан");

                document.getElementById("adminNftCode").value = "";

                await this.load();

                window.Upgrade?.load();
                window.Craft?.load();

            } catch (error) {
                app.notice(error.message || "Не удалось выдать NFT");
            }
        },

        init() {
            const sellAllButton =
                document.getElementById("sellAllButton");

            const soundSwitch =
                document.getElementById("soundSwitch");

            const adminSwitch =
                document.getElementById("adminSwitch");

            const giveButton =
                document.getElementById("adminGiveG");

            const takeButton =
                document.getElementById("adminTakeG");

            const giveNftButton =
                document.getElementById("adminGiveNft");

            if (sellAllButton) {
                sellAllButton.onclick = () => this.sellAll();
            }

            if (soundSwitch) {
                soundSwitch.onclick = () => this.setSound();
            }

            if (adminSwitch) {
                adminSwitch.onclick = () => this.toggleAdmin();
            }

            if (giveButton) {
                giveButton.onclick = () => this.adminAction("give");
            }

            if (takeButton) {
                takeButton.onclick = () => this.adminAction("take");
            }

            if (giveNftButton) {
                giveNftButton.onclick = () => this.giveNft();
            }

            const showAdmin =
                localStorage.getItem("nft_show_admin") === "1";

            if (adminSwitch) {
                adminSwitch.classList.toggle("on", showAdmin);
            }
        }
    };

    window.Profile = Profile;
    Profile.init();
})();
