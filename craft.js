(function () {
    "use strict";

    let inventory = [];
    let selectedItems = [];
    let busy = false;
    let craftResult = null;
    let statusMessage = "";

    const API = "https://cs-go-case.onrender.com";

    const style = `
    #craft-app {
        color: white;
        font-family: Arial, sans-serif;
        padding: 15px;
    }
    #craft-app .craft-title {
        font-size: 23px;
        font-weight: bold;
        margin-bottom: 8px;
    }
    #craft-app .craft-subtitle {
        color: #9ba8bd;
        font-size: 13px;
        margin-bottom: 16px;
    }
    #craft-app .craft-info {
        background: #151f32;
        border: 1px solid #263754;
        border-radius: 12px;
        padding: 13px;
        margin-bottom: 14px;
    }
    #craft-app .craft-items {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 9px;
    }
    #craft-app .craft-item {
        background: #111b2c;
        border: 1px solid #263754;
        border-radius: 12px;
        padding: 12px 8px;
        text-align: center;
        cursor: pointer;
        min-width: 0;
    }
    #craft-app .craft-item.selected {
        border: 2px solid #8b5cf6;
        background: #252044;
    }
    #craft-app .craft-item.disabled {
        opacity: .35;
        cursor: default;
    }
    #craft-app .craft-item-name {
        font-size: 13px;
        font-weight: bold;
        overflow-wrap: anywhere;
        margin-bottom: 7px;
    }
    #craft-app .craft-price {
        color: #43d9a3;
        font-size: 13px;
    }
    #craft-app .craft-count {
        color: #aab7cc;
        font-size: 11px;
        margin-top: 5px;
    }
    #craft-app .craft-button {
        width: 100%;
        border: 0;
        border-radius: 12px;
        padding: 15px;
        margin-top: 14px;
        background: linear-gradient(100deg, #7048e8, #a044e8);
        color: white;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
    }
    #craft-app .craft-button:disabled {
        opacity: .4;
    }
    #craft-app .craft-result {
        display: none;
        margin-top: 14px;
        padding: 16px;
        text-align: center;
        border-radius: 12px;
        background: #17283a;
        border: 1px solid #43d9a3;
    }
    #craft-app .craft-multiplier {
        font-size: 30px;
        font-weight: bold;
        color: #43d9a3;
        margin: 8px;
    }
    #craft-app .craft-message {
        color: #ff8585;
        font-size: 13px;
        margin-top: 10px;
    }
    #craft-app .craft-empty {
        color: #9ba8bd;
        text-align: center;
        padding: 25px 10px;
        background: #111b2c;
        border-radius: 12px;
    }
    `;

    function money(value) {
        return Number(value || 0).toLocaleString("ru-RU") + " DC";
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[char]);
    }

    function getHeaders() {
        const tg = window.Telegram && window.Telegram.WebApp;

        return {
            "Content-Type": "application/json",
            "X-Telegram-Init-Data": tg ? tg.initData : ""
        };
    }

    function getRoot() {
        return document.getElementById("craft-app");
    }

    function getTotal() {
        return selectedItems.reduce((sum, item) => {
            return sum + Number(item.price || 0);
        }, 0);
    }

    function renderResult() {
        if (!craftResult) return "";

        return `
            <div class="craft-result" style="display:block">
                <div>🎉 КРАФТ УСПЕШЕН!</div>
                <div class="craft-multiplier">
                    ×${escapeHtml(craftResult.multiplier)}
                </div>
                <div style="font-weight:bold;margin:8px">
                    ${escapeHtml(craftResult.name)}
                </div>
                <div style="color:#43d9a3">
                    Стоимость: ${money(craftResult.price)}
                </div>
            </div>
        `;
    }

    function render() {
        const root = getRoot();
        if (!root) return;

        const total = getTotal();

        const itemsHtml = inventory.length
            ? inventory.map((item, index) => {
                const selectedCount = selectedItems.filter(
                    x => Number(x.skin_id) === Number(item.skin_id)
                ).length;

                const available = Number(item.quantity || 0);
                const selected = selectedCount > 0;

                const disabled =
                    selectedItems.length >= 5 &&
                    selectedCount >= available;

                return `
                    <div class="craft-item
                        ${selected ? "selected" : ""}
                        ${disabled ? "disabled" : ""}"
                        data-index="${index}">

                        <div class="craft-item-name">
                            ${escapeHtml(item.name)}
                        </div>

                        <div class="craft-price">
                            ${money(item.price)}
                        </div>

                        <div class="craft-count">
                            В наличии: ${available}
                            ${selectedCount
                                ? " | Выбрано: " + selectedCount
                                : ""}
                        </div>
                    </div>
                `;
            }).join("")
            : `<div class="craft-empty">
                В инвентаре пока нет предметов.
                <br><br>
                Открой кейс, чтобы получить скины.
               </div>`;

        root.innerHTML = `
            <div class="craft-title">⚒️ КРАФТ</div>

            <div class="craft-subtitle">
                Выбери ровно 5 предметов и получи один новый предмет.
                Нажми на выбранный предмет ещё раз, чтобы убрать его.
            </div>

            <div class="craft-info">
                <div>
                    Выбрано:
                    <b>${selectedItems.length} / 5</b>
                </div>

                <div style="margin-top:7px">
                    Общая стоимость:
                    <b style="color:#43d9a3">
                        ${money(total)}
                    </b>
                </div>
            </div>

            <div class="craft-items">
                ${itemsHtml}
            </div>

            <button class="craft-button" id="craft-run"
                ${selectedItems.length !== 5 || busy ? "disabled" : ""}>
                ${busy ? "КРАФТ..." : "⚒️ СОЗДАТЬ ПРЕДМЕТ"}
            </button>

            <div class="craft-message" id="craft-message">
                ${escapeHtml(statusMessage)}
            </div>

            ${renderResult()}
        `;

        root.querySelectorAll(".craft-item").forEach(element => {
            element.addEventListener("click", () => {
                if (busy) return;

                const item = inventory[Number(element.dataset.index)];

                if (!item) return;

                const skinId = Number(item.skin_id);

                const selectedIndex = selectedItems.findIndex(
                    x => Number(x.skin_id) === skinId
                );

                // Повторное нажатие убирает один выбранный предмет
                if (selectedIndex !== -1) {
                    selectedItems.splice(selectedIndex, 1);
                    render();
                    return;
                }

                if (selectedItems.length >= 5) return;

                const selectedCount = selectedItems.filter(
                    x => Number(x.skin_id) === skinId
                ).length;

                if (selectedCount >= Number(item.quantity || 0)) {
                    return;
                }

                selectedItems.push(item);
                render();
            });
        });

        const button = root.querySelector("#craft-run");

        if (button) {
            button.addEventListener("click", runCraft);
        }
    }

    async function loadCraft() {
        const root = getRoot();
        if (!root) return;

        root.innerHTML = "<div>Загрузка инвентаря...</div>";

        try {
            const response = await fetch(API + "/api/craft", {
                method: "GET",
                headers: getHeaders(),
                cache: "no-store"
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Ошибка загрузки");
            }

            if (!Array.isArray(data.inventory)) {
                throw new Error("Сервер вернул неверный формат инвентаря");
            }

            inventory = data.inventory;
            selectedItems = [];
            statusMessage = "";

            render();

        } catch (error) {
            root.innerHTML = `
                <div class="craft-message">
                    Не удалось загрузить крафт:
                    ${escapeHtml(error.message)}
                </div>

                <button class="craft-button" id="craft-retry">
                    Повторить
                </button>
            `;

            const retry = root.querySelector("#craft-retry");

            if (retry) {
                retry.onclick = loadCraft;
            }
        }
    }

    async function runCraft() {
        if (busy || selectedItems.length !== 5) return;

        busy = true;
        statusMessage = "";
        craftResult = null;

        render();

        try {
            const response = await fetch(API + "/api/craft", {
                method: "POST",
                headers: getHeaders(),
                body: JSON.stringify({
                    items: selectedItems.map(item =>
                        Number(item.skin_id)
                    )
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Крафт не выполнен");
            }

            // Сервер возвращает предмет в data.skin
            const reward = data.skin || data.reward || {};

            craftResult = {
                multiplier: data.multiplier,
                name: reward.name || "Новый предмет",
                price: reward.price ?? data.reward_price ?? 0
            };

            selectedItems = [];

            if (typeof window.loadBalance === "function") {
                window.loadBalance();
            }

            busy = false;

            // Загружаем обновлённый инвентарь
            await loadCraft();

            // Результат остаётся на экране после обновления
            render();

        } catch (error) {
            busy = false;
            statusMessage = error.message;
            render();
        }
    }

    function initCraft() {
        // Добавляем стили только один раз
        if (!document.getElementById("craft-style")) {
            const styleElement = document.createElement("style");

            styleElement.id = "craft-style";
            styleElement.textContent = style;

            document.head.appendChild(styleElement);
        }

        // ВАЖНО: загружаем инвентарь при каждом открытии страницы
        loadCraft();
    }

    window.initCraft = initCraft;
    window.loadCraft = loadCraft;

})();
