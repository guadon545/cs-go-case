
// ========================================
// GUADON COIN — UPGRADE MODULE
// ========================================

(function () {
    "use strict";

    let inventory = [];
    let targets = [];
    let selectedSource = null;
    let selectedTarget = null;
    let busy = false;

    const style = `
    #upgrade-app { color:white; }
    #upgrade-app .up-card {
        background:#121b2d;
        border:1px solid #263550;
        border-radius:14px;
        padding:14px;
        margin-bottom:12px;
    }
    #upgrade-app .up-label {
        color:#91baff;
        font-size:12px;
        margin-bottom:10px;
    }
    #upgrade-app .up-select {
        width:100%;
        background:#080c16;
        color:white;
        border:1px solid #344767;
        border-radius:9px;
        padding:12px;
        margin-bottom:10px;
        font-size:14px;
    }
    #upgrade-app .up-chance {
        font-size:32px;
        font-weight:900;
        text-align:center;
        color:#80e6a0;
        margin:12px 0;
    }
    #upgrade-app .up-button {
        width:100%;
        padding:15px;
        border:0;
        border-radius:11px;
        background:linear-gradient(135deg,#347cff,#754bff);
        color:white;
        font-weight:bold;
        font-size:15px;
    }
    #upgrade-app .up-button:disabled {
        opacity:.5;
    }
    #upgrade-app .up-info {
        color:#91a5c5;
        font-size:12px;
        line-height:1.6;
        text-align:center;
        margin:12px 0;
    }
    #upgrade-app .up-notice {
        padding:12px;
        border-radius:9px;
        background:#1c2940;
        margin-top:12px;
        font-size:13px;
        display:none;
        line-height:1.5;
    }
    #upgrade-app .up-notice.show {
        display:block;
    }
    `;

    function addStyles() {
        if (document.getElementById("upgrade-styles")) return;

        const element = document.createElement("style");
        element.id = "upgrade-styles";
        element.textContent = style;
        document.head.appendChild(element);
    }

    function escape(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&":"&amp;",
            "<":"&lt;",
            ">":"&gt;",
            '"':"&quot;",
            "'":"&#039;"
        })[char]);
    }

    function chance() {
        if (!selectedSource || !selectedTarget) return 0;

        const sourcePrice = Number(selectedSource.price);
        const targetPrice = Number(selectedTarget.price);

        if (!sourcePrice || !targetPrice ||
            targetPrice <= sourcePrice) return 0;

        return Math.min(
            90,
            sourcePrice / targetPrice * 90
        );
    }

    function notice(message) {
        const box = document.getElementById("upgrade-notice");
        if (!box) return;

        box.textContent = message;
        box.classList.add("show");
    }

    function render() {
        const root = document.getElementById("upgrade-app");
        if (!root) return;

        const sourceOptions = inventory.map((skin, index) => `
            <option value="${index}">
                ${escape(skin.name)} —
                ${Number(skin.price).toLocaleString("ru-RU")} DC
                (x${Number(skin.quantity)})
            </option>
        `).join("");

        const targetOptions = targets.map((skin, index) => `
            <option value="${index}">
                ${escape(skin.name)} —
                ${Number(skin.price).toLocaleString("ru-RU")} DC
            </option>
        `).join("");

        root.innerHTML = `
            <div class="up-card">
                <div class="up-label">🔫 ТВОЙ ИСХОДНЫЙ СКИН</div>

                <select class="up-select" id="upgrade-source">
                    <option value="">Выбери скин из инвентаря</option>
                    ${sourceOptions}
                </select>

                <div class="up-label">🎯 ЖЕЛАЕМЫЙ СКИН</div>

                <select class="up-select" id="upgrade-target">
                    <option value="">Выбери целевой скин</option>
                    ${targetOptions}
                </select>
            </div>

            <div class="up-card">
                <div class="up-label" style="text-align:center">
                    ШАНС УСПЕХА
                </div>

                <div class="up-chance" id="upgrade-chance">0%</div>

                <div class="up-info" id="upgrade-info">
                    Сначала выбери два скина.
                </div>

                <button class="up-button" id="upgrade-button" disabled>
                    ⚡ АПГРЕЙД
                </button>

                <div class="up-notice" id="upgrade-notice"></div>
            </div>

            <div class="up-info">
                ❗ При неудаче исходный скин полностью сгорает.
                <br>
                Максимальный шанс успеха — 90%.
            </div>
        `;

        document.getElementById("upgrade-source")
            .addEventListener("change", event => {
                selectedSource = event.target.value === ""
                    ? null
                    : inventory[Number(event.target.value)];

                updateChance();
            });

        document.getElementById("upgrade-target")
            .addEventListener("change", event => {
                selectedTarget = event.target.value === ""
                    ? null
                    : targets[Number(event.target.value)];

                updateChance();
            });

        document.getElementById("upgrade-button")
            .addEventListener("click", performUpgrade);

        updateChance();
    }

    function updateChance() {
        const chanceElement = document.getElementById("upgrade-chance");
        const info = document.getElementById("upgrade-info");
        const button = document.getElementById("upgrade-button");

        if (!chanceElement || !info || !button) return;

        const value = chance();

        chanceElement.textContent = value.toFixed(2) + "%";

        if (busy) {
            button.disabled = true;
            button.textContent = "АПГРЕЙД...";
            return;
        }

        button.textContent = "⚡ АПГРЕЙД";

        if (!selectedSource || !selectedTarget) {
            info.textContent = "Сначала выбери два скина.";
            button.disabled = true;
            return;
        }

        if (Number(selectedTarget.price) <= Number(selectedSource.price)) {
            info.textContent =
                "Целевой скин должен быть дороже исходного.";
            button.disabled = true;
            return;
        }

        info.textContent =
            "Исходный: " +
            Number(selectedSource.price).toLocaleString("ru-RU") +
            " DC | Целевой: " +
            Number(selectedTarget.price).toLocaleString("ru-RU") +
            " DC";

        button.disabled = false;
    }

    async function performUpgrade() {
        if (busy || !selectedSource || !selectedTarget) return;

        if (Number(selectedTarget.price) <= Number(selectedSource.price)) {
            notice("Целевой скин должен быть дороже исходного.");
            return;
        }

        const sourceId = selectedSource.id;
        const targetId = selectedTarget.id;

        busy = true;
        updateChance();

        try {
            const result = await apiRequest("/api/upgrade", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    source_skin_id: sourceId,
                    target_skin_id: targetId
                })
            });

            if (!result.success) {
                throw new Error(result.error || "Ошибка апгрейда");
            }

            const message = result.won
                ? "🎉 УСПЕХ! Получен скин: " +
                  result.target.name +
                  ". Шанс: " + result.chance + "%"
                : "❌ НЕУДАЧА! Скин " +
                  result.source.name +
                  " сгорел. Шанс был: " +
                  result.chance + "%";

            busy = false;

            selectedSource = null;
            selectedTarget = null;

            await loadData();

            notice(message);

        } catch (error) {
            busy = false;
            updateChance();

            notice("Ошибка: " + error.message);
        }
    }

    async function loadData() {
        const root = document.getElementById("upgrade-app");
        if (!root) return;

        root.innerHTML =
            '<div class="placeholder">Загрузка апгрейда...</div>';

        try {
            const [inventoryData, casesData] = await Promise.all([
                apiRequest("/api/inventory"),
                apiRequest("/api/cases")
            ]);

            inventory = (inventoryData.inventory || []).map(skin => ({
                id: Number(skin.skin_id),
                name: skin.name,
                rarity: skin.rarity,
                price: Number(skin.price),
                quantity: Number(skin.quantity)
            }));

            const unique = new Map();

            (casesData.cases || []).forEach(item => {
                (item.items || []).forEach(skin => {
                    const id = Number(skin.id);

                    if (id && !unique.has(id)) {
                        unique.set(id, {
                            id,
                            name: skin.name,
                            rarity: skin.rarity,
                            price: Number(skin.price)
                        });
                    }
                });
            });

            targets = Array.from(unique.values());

            addStyles();
            render();

            if (!inventory.length) {
                notice("Инвентарь пуст. Сначала открой кейс.");
            }

        } catch (error) {
            root.innerHTML =
                '<div class="placeholder">Ошибка загрузки: ' +
                escape(error.message) + '</div>';
        }
    }

    function init() {
        const page = document.getElementById("upgrade");
        if (!page) return;

        const oldRoot = document.getElementById("upgrade-app");

        if (oldRoot) {
            oldRoot.remove();
        }

        const placeholder = page.querySelector(".placeholder");

        if (placeholder) {
            placeholder.remove();
        }

        const root = document.createElement("div");
        root.id = "upgrade-app";
        page.appendChild(root);

        selectedSource = null;
        selectedTarget = null;
        busy = false;

        loadData();
    }

    window.initUpgrade = init;

    document.addEventListener("click", event => {
        const button = event.target.closest(
            '[onclick*="showPage(\'upgrade\'"]'
        );

        if (button) {
            setTimeout(init, 100);
        }
    });

})();
