
(function () {
    "use strict";

    let inventory = [];
    let selectedItems = [];
    let busy = false;
    let craftResult = null;
    let statusMessage = "";
    let debugMessage = "Ожидание загрузки...";
    let httpStatus = "—";

    const API = "https://cs-go-case.onrender.com";

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

    async function loadCraft() {
        const root = getRoot();
        if (!root) return;

        root.innerHTML = `
            <div style="padding:15px;color:white">
                <h3>Загрузка крафта...</h3>
                <p>Проверяем соединение с сервером.</p>
            </div>
        `;

        try {
            const tg = window.Telegram && window.Telegram.WebApp;

            debugMessage = "Telegram: " +
                (tg && tg.initData ? "Авторизация найдена" : "Нет initData");

            const response = await fetch(API + "/api/craft", {
                method: "GET",
                headers: getHeaders(),
                cache: "no-store"
            });

            httpStatus = response.status;

            const raw = await response.text();
            let data;

            try {
                data = JSON.parse(raw);
            } catch (e) {
                throw new Error("Сервер вернул не JSON: " + raw.slice(0, 200));
            }

            if (!response.ok) {
                throw new Error(data.error || "Ошибка HTTP " + response.status);
            }

            if (!Array.isArray(data.inventory)) {
                throw new Error("В ответе сервера отсутствует массив inventory");
            }

            inventory = data.inventory;
            selectedItems = [];
            statusMessage = "";
            debugMessage = "Успешно загружено предметов: " + inventory.length;

            render();

        } catch (error) {
            debugMessage = "Ошибка: " + error.message;

            root.innerHTML = `
                <div style="padding:15px;color:white">
                    <h2>⚒️ Крафт</h2>
                    <div style="background:#172033;padding:15px;border-radius:12px;margin-top:15px">
                        <h3 style="color:#ff7777">Ошибка загрузки</h3>
                        <p style="margin-top:10px;word-break:break-word">
                            ${escapeHTML(error.message)}
                        </p>
                        <p style="margin-top:10px;color:#aaa">
                            HTTP: ${httpStatus}
                        </p>
                        <button onclick="window.loadCraft()"
                            style="margin-top:15px;padding:12px;background:#3478f6;color:white;border:0;border-radius:8px;width:100%">
                            Повторить
                        </button>
                    </div>
                    ${debugPanel()}
                </div>
            `;
        }
    }

    function escapeHTML(value) {
        return String(value).replace(/[&<>"']/g, function (char) {
            return {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#039;"
            }[char];
        });
    }

    function debugPanel() {
        return `
            <div style="margin-top:15px;background:#101827;padding:12px;border-radius:10px;font-size:13px">
                <b>Диагностика</b>
                <p style="margin-top:8px">HTTP: ${httpStatus}</p>
                <p>${escapeHTML(debugMessage)}</p>
            </div>
        `;
    }

    function getSelectedPrice() {
        return selectedItems.reduce(function (sum, item) {
            return sum + Number(item.price || 0);
        }, 0);
    }

    function render() {
        const root = getRoot();
        if (!root) return;

        const total = getSelectedPrice();

        let itemsHTML = "";

        if (inventory.length === 0) {
            itemsHTML = `
                <p style="color:#aaa;padding:15px">
                    Предметы не найдены. Сервер вернул пустой инвентарь.
                </p>
            `;
        } else {
            itemsHTML = inventory.map(function (item) {
                const count = Number(item.quantity || 0);
                const selectedCount = selectedItems.filter(
                    x => Number(x.skin_id) === Number(item.skin_id)
                ).length;

                return `
                    <div class="craft-item"
                        data-id="${Number(item.skin_id)}"
                        style="
                            background:${selectedCount ? '#263b5c' : '#172033'};
                            border:1px solid ${selectedCount ? '#5599ff' : '#29364d'};
                            padding:12px;
                            border-radius:10px;
                            margin-bottom:9px;
                            display:flex;
                            justify-content:space-between;
                            align-items:center;
                            cursor:pointer;
                        ">
                        <div>
                            <b>${escapeHTML(item.name)}</b>
                            <div style="color:#aaa;font-size:12px;margin-top:5px">
                                ${escapeHTML(item.rarity || "Предмет")}
                            </div>
                            <div style="color:#aaa;font-size:12px">
                                ${Number(item.price).toLocaleString("ru-RU")} DC
                            </div>
                        </div>
                        <div style="text-align:right">
                            <b>${selectedCount ? "✓ " + selectedCount : ""}</b>
                            <div style="color:#aaa;font-size:12px">
                                В наличии: ${count}
                            </div>
                        </div>
                    </div>
                `;
            }).join("");
        }

        root.innerHTML = `
            <div style="color:white;padding:12px">
                <h2>⚒️ Крафт</h2>
                <p style="color:#aaa;margin-top:5px">
                    Выбери ровно 5 предметов
                </p>

                <div style="background:#172033;padding:14px;border-radius:12px;margin:15px 0">
                    <div>Выбрано: <b>${selectedItems.length}/5</b></div>
                    <div style="margin-top:7px">
                        Общая стоимость: <b>${total.toLocaleString("ru-RU")} DC</b>
                    </div>
                </div>

                <div id="craft-items">${itemsHTML}</div>

                <button id="craft-create"
                    ${selectedItems.length !== 5 || busy ? "disabled" : ""}
                    style="
                        width:100%;
                        padding:15px;
                        border:0;
                        border-radius:10px;
                        margin-top:12px;
                        background:${selectedItems.length === 5 && !busy ? '#3478f6' : '#354052'};
                        color:white;
                        font-weight:bold;
                    ">
                    ${busy ? "Создание..." : "Создать предмет"}
                </button>

                <div style="margin-top:12px;color:#aaa;font-size:13px">
                    ${escapeHTML(statusMessage)}
                </div>

                ${craftResult ? `
                    <div style="background:#172b27;padding:15px;border-radius:12px;margin-top:15px">
                        <h3>🎉 Результат крафта</h3>
                        <p style="margin-top:8px">${escapeHTML(craftResult.name)}</p>
                        <p>Стоимость: ${Number(craftResult.price || 0).toLocaleString("ru-RU")} DC</p>
                    </div>
                ` : ""}

                ${debugPanel()}
            </div>
        `;

        root.querySelectorAll(".craft-item").forEach(function (element) {
            element.addEventListener("click", function () {
                if (busy || selectedItems.length >= 5) return;

                const id = Number(element.dataset.id);
                const item = inventory.find(x => Number(x.skin_id) === id);

                if (!item) return;

                const alreadySelected = selectedItems.filter(
                    x => Number(x.skin_id) === id
                ).length;

                if (alreadySelected >= Number(item.quantity)) return;

                selectedItems.push(item);
                render();
            });
        });

        const createButton = root.querySelector("#craft-create");
        if (createButton) {
            createButton.addEventListener("click", runCraft);
        }
    }

    async function runCraft() {
        if (selectedItems.length !== 5 || busy) return;

        busy = true;
        statusMessage = "";
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

            if (!response.ok || !data.success) {
                throw new Error(data.error || "Не удалось создать предмет");
            }

            craftResult = data.skin || data.reward || null;
            statusMessage = data.message || "Крафт успешно завершён!";

            await loadCraft();

        } catch (error) {
            statusMessage = "Ошибка: " + error.message;
        } finally {
            busy = false;
            render();
        }
    }

    window.initCraft = function () {
        loadCraft();
    };

    window.loadCraft = loadCraft;

})();
