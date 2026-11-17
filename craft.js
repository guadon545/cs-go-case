
(function () {
    "use strict";

    let inventory = [];
    let selectedItems = [];
    let busy = false;

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
    `;

    function money(value) {
        return Number(value || 0).toLocaleString("ru-RU") + " DC";
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

    function render() {
        const root = getRoot();
        if (!root) return;

        const total = getTotal();

        root.innerHTML = `
            <div class="craft-title">⚒️ КРАФТ</div>
            <div class="craft-subtitle">
                Выбери ровно 5 предметов и получи один новый предмет.
            </div>

            <div class="craft-info">
                <div>Выбрано: <b>${selectedItems.length} / 5</b></div>
                <div style="margin-top:7px">
                    Общая стоимость: <b style="color:#43d9a3">${money(total)}</b>
                </div>
            </div>

            <div class="craft-items">
                ${inventory.map((item, index) => {
                    const selectedCount = selectedItems.filter(
                        x => Number(x.skin_id) === Number(item.skin_id)
                    ).length;

                    const available = Number(item.quantity || 1);
                    const selected = selectedCount > 0;

                    return `
                        <div class="craft-item ${selected ? "selected" : ""} ${
                            selectedItems.length >= 5 && !selected ? "disabled" : ""
                        }" data-index="${index}">
                            <div class="craft-item-name">${escapeHtml(item.name)}</div>
                            <div class="craft-price">${money(item.price)}</div>
                            <div class="craft-count">
                                В наличии: ${available}
                                ${selectedCount ? " | Выбрано: " + selectedCount : ""}
                            </div>
                        </div>
                    `;
                }).join("")}
            </div>

            <button class="craft-button" id="craft-run"
                ${selectedItems.length !== 5 || busy ? "disabled" : ""}>
                ${busy ? "КРАФТ..." : "⚒️ СОЗДАТЬ ПРЕДМЕТ"}
            </button>

            <div class="craft-message" id="craft-message"></div>

            <div class="craft-result" id="craft-result"></div>
        `;

        root.querySelectorAll(".craft-item").forEach(element => {
            element.addEventListener("click", () => {
                if (busy || selectedItems.length >= 5 &&
                    !selectedItems.some(x =>
                        Number(x.skin_id) === Number(
                            inventory[Number(element.dataset.index)].skin_id
                        )
                    )) return;

                const item = inventory[Number(element.dataset.index)];
                const selectedCount = selectedItems.filter(
                    x => Number(x.skin_id) === Number(item.skin_id)
                ).length;

                if (selectedCount >= Number(item.quantity || 1)) return;

                selectedItems.push(item);
                render();
            });
        });

        root.querySelector("#craft-run").addEventListener("click", runCraft);
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

    async function loadCraft() {
        const root = getRoot();
        if (!root) return;

        root.innerHTML = "<div>Загрузка инвентаря...</div>";

        try {
            const response = await fetch(API + "/api/craft", {
                headers: getHeaders()
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Ошибка загрузки");
            }

            inventory = data.inventory || [];
            selectedItems = [];
            render();

        } catch (error) {
            root.innerHTML = `
                <div class="craft-message">
                    Не удалось загрузить крафт: ${escapeHtml(error.message)}
                </div>
                <button class="craft-button" id="craft-retry">Повторить</button>
            `;
            root.querySelector("#craft-retry").onclick = loadCraft;
        }
    }

    async function runCraft() {
        if (busy || selectedItems.length !== 5) return;

        busy = true;
        const root = getRoot();
        const message = root.querySelector("#craft-message");
        message.textContent = "";

        render();

        try {
            const response = await fetch(API + "/api/craft", {
                method: "POST",
                headers: getHeaders(),
                body: JSON.stringify({
                    items: selectedItems.map(item => Number(item.skin_id))
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Крафт не выполнен");
            }

            const multiplier = data.multiplier;
            const reward = data.reward || {};
            const result = root.querySelector("#craft-result");

            result.style.display = "block";
            result.innerHTML = `
                <div>🎉 КРАФТ УСПЕШЕН!</div>
                <div class="craft-multiplier">×${escapeHtml(multiplier)}</div>
                <div style="font-weight:bold;margin:8px">
                    ${escapeHtml(reward.name || "Новый предмет")}
                </div>
                <div style="color:#43d9a3">
                    Стоимость: ${money(reward.price)}
                </div>
            `;

            selectedItems = [];
            await loadCraft();

            const updatedResult = root.querySelector("#craft-result");
            if (updatedResult) {
                updatedResult.style.display = "block";
                updatedResult.innerHTML = result.innerHTML;
            }

            if (typeof window.loadBalance === "function") {
                window.loadBalance();
            }

        } catch (error) {
            busy = false;
            render();
            const message = root.querySelector("#craft-message");
            if (message) message.textContent = error.message;
            return;
        }

        busy = false;
        render();

    }

    function initCraft() {
        if (document.getElementById("craft-style")) return;

        const styleElement = document.createElement("style");
        styleElement.id = "craft-style";
        styleElement.textContent = style;
        document.head.appendChild(styleElement);

        if (!document.getElementById("craft-app")) {
            const container = document.createElement("div");
            container.id = "craft-app";
            document.body.appendChild(container);
        }

        loadCraft();
    }

    window.initCraft = initCraft;
    window.loadCraft = loadCraft;

})();
