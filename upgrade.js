
(function () {
    "use strict";

    let inventory = [];
    let selectedSource = null;
    let selectedMode = "multiplier";
    let selectedOption = "x2";
    let busy = false;

    const OPTIONS = {
        multiplier: {
            x2: { chance: 50, multiplier: 2 },
            x5: { chance: 30, multiplier: 5 },
            x10: { chance: 10, multiplier: 10 }
        },
        chance: {
            "30": { chance: 30, multiplier: 3.5 },
            "50": { chance: 50, multiplier: 2 },
            "75": { chance: 75, multiplier: 1.333333 }
        }
    };

    const style = `
    #upgrade-app { color:white; }

    #upgrade-app .up-card {
        background:#121b2d;
        border:1px solid #263550;
        border-radius:16px;
        padding:15px;
        margin-bottom:13px;
    }

    #upgrade-app .up-label {
        color:#91baff;
        font-size:12px;
        font-weight:800;
        margin-bottom:11px;
    }

    #upgrade-app .up-select {
        width:100%;
        background:#080c16;
        color:white;
        border:1px solid #344767;
        border-radius:10px;
        padding:13px;
        margin-bottom:12px;
        font-size:14px;
    }

    #upgrade-app .up-tabs,
    #upgrade-app .up-options {
        display:grid;
        grid-template-columns:repeat(2,1fr);
        gap:9px;
        margin-bottom:13px;
    }

    #upgrade-app .up-options {
        grid-template-columns:repeat(3,1fr);
    }

    #upgrade-app .up-choice {
        background:#0b1425;
        border:1px solid #344767;
        color:#b9c9e5;
        border-radius:11px;
        padding:13px 5px;
        font-weight:900;
        font-size:16px;
    }

    #upgrade-app .up-choice small {
        display:block;
        font-size:10px;
        font-weight:500;
        margin-top:5px;
        color:#91a5c5;
    }

    #upgrade-app .up-choice.active {
        background:linear-gradient(135deg,#245caa,#493a9e);
        border-color:#70aaff;
        color:white;
        box-shadow:0 0 15px #397cff44;
    }

    #upgrade-app .up-wheel-wrap {
        display:flex;
        justify-content:center;
        padding:12px 0 18px;
    }

    #upgrade-app .up-wheel {
        width:min(75vw,260px);
        aspect-ratio:1;
        position:relative;
        border-radius:50%;
        border:9px solid #293954;
        box-shadow:0 0 25px #0008,inset 0 0 15px #0008;
        background:conic-gradient(
            from 0deg,
            #32d47b 0%,
            #32d47b 50%,
            #29364d 50%,
            #29364d 100%
        );
    }

    #upgrade-app .up-wheel::before {
        content:"";
        position:absolute;
        inset:8px;
        border:2px solid #ffffff22;
        border-radius:50%;
        pointer-events:none;
    }

    #upgrade-app .up-pointer {
        position:absolute;
        inset:0;
        z-index:3;
        transform:rotate(0deg);
        transform-origin:50% 50%;
    }

    #upgrade-app .up-pointer::before {
        content:"";
        position:absolute;
        left:calc(50% - 2px);
        top:9%;
        width:4px;
        height:41%;
        background:white;
        border-radius:5px;
        box-shadow:0 0 9px white;
    }

    #upgrade-app .up-pointer::after {
        content:"";
        position:absolute;
        left:calc(50% - 8px);
        top:5%;
        border-left:8px solid transparent;
        border-right:8px solid transparent;
        border-bottom:15px solid white;
        filter:drop-shadow(0 0 4px white);
    }

    #upgrade-app .up-wheel-center {
        position:absolute;
        z-index:4;
        width:28px;
        height:28px;
        border-radius:50%;
        background:linear-gradient(135deg,#e5efff,#7187a9);
        border:4px solid #263650;
        left:50%;
        top:50%;
        transform:translate(-50%,-50%);
    }

    #upgrade-app .up-chance {
        text-align:center;
        font-size:31px;
        font-weight:900;
        color:#65e99b;
        margin:3px 0;
    }

    #upgrade-app .up-info {
        color:#91a5c5;
        font-size:12px;
        line-height:1.6;
        text-align:center;
        margin:10px 0;
    }

    #upgrade-app .up-prize {
        color:#80e6a0;
        font-weight:900;
        font-size:17px;
    }

    #upgrade-app .up-button {
        width:100%;
        padding:16px;
        border:0;
        border-radius:12px;
        background:linear-gradient(135deg,#347cff,#754bff);
        color:white;
        font-weight:900;
        font-size:16px;
    }

    #upgrade-app .up-button:disabled {
        opacity:.45;
    }

    #upgrade-app .up-notice {
        padding:13px;
        border-radius:10px;
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

    function money(value) {
        return Number(value || 0).toLocaleString("ru-RU");
    }

    function getOption() {
        return OPTIONS[selectedMode]?.[selectedOption] || null;
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
                ${escape(skin.name)} — ${money(skin.price)} DC
                (x${skin.quantity})
            </option>
        `).join("");

        root.innerHTML = `
            <div class="up-card">

                <div class="up-label">
                    🔫 ВЫБЕРИ СВОЙ СКИН
                </div>

                <select class="up-select" id="upgrade-source">
                    <option value="">Выбери скин из инвентаря</option>
                    ${sourceOptions}
                </select>

                <div class="up-info">
                    Выбранный скин будет использован как ставка.
                </div>

            </div>

            <div class="up-card">

                <div class="up-label">
                    ⚡ ВЫБЕРИ РЕЖИМ АПГРЕЙДА
                </div>

                <div class="up-tabs">

                    <button class="up-choice active"
                        data-mode="multiplier">
                        МНОЖИТЕЛЬ
                        <small>x2 / x5 / x10</small>
                    </button>

                    <button class="up-choice"
                        data-mode="chance">
                        ПРОЦЕНТ
                        <small>30 / 50 / 75%</small>
                    </button>

                </div>

                <div class="up-options" id="upgrade-options"></div>

            </div>

            <div class="up-card">

                <div class="up-label" style="text-align:center">
                    🎯 ШАНС ПОБЕДЫ
                </div>

                <div class="up-chance" id="upgrade-chance">
                    50%
                </div>

                <div class="up-wheel-wrap">

                    <div class="up-wheel" id="upgrade-wheel">

                        <div class="up-pointer"
                            id="upgrade-pointer"></div>

                        <div class="up-wheel-center"></div>

                    </div>

                </div>

                <div class="up-info">
                    Зелёная зона — победа.
                    Стрелка определит результат.
                </div>

                <div class="up-info" id="upgrade-info">
                    Выбери скин из инвентаря.
                </div>

                <div style="text-align:center;margin:15px 0">
                    <div class="up-info">Примерная стоимость приза</div>
                    <div class="up-prize" id="upgrade-prize">
                        0 DC
                    </div>
                </div>

                <button class="up-button"
                    id="upgrade-button" disabled>
                    ⚡ АПГРЕЙД
                </button>

                <div class="up-notice" id="upgrade-notice"></div>

            </div>

            <div class="up-info">
                При проигрыше исходный скин сгорает.
                Максимальный шанс успеха — 80%.
            </div>
        `;

        document.getElementById("upgrade-source")
            .addEventListener("change", event => {
                selectedSource = event.target.value === ""
                    ? null
                    : inventory[Number(event.target.value)];

                updateChance();
            });

        root.querySelectorAll("[data-mode]").forEach(button => {
            button.addEventListener("click", () => {
                selectedMode = button.dataset.mode;
                selectedOption = selectedMode === "multiplier"
                    ? "x2"
                    : "30";

                render();
            });
        });

        renderOptions();

        document.getElementById("upgrade-button")
            .addEventListener("click", performUpgrade);

        updateChance();
    }

    function renderOptions() {
        const container = document.getElementById("upgrade-options");
        if (!container) return;

        const options = OPTIONS[selectedMode];

        container.innerHTML = Object.entries(options).map(([key, data]) => {
            const title = selectedMode === "multiplier"
                ? key
                : key + "%";

            const subtitle = selectedMode === "multiplier"
                ? data.chance + "% шанс"
                : "Приз x" + data.multiplier;

            return `
                <button class="up-choice ${
                    selectedOption === key ? "active" : ""
                }" data-option="${key}">
                    ${title}
                    <small>${subtitle}</small>
                </button>
            `;
        }).join("");

        container.querySelectorAll("[data-option]").forEach(button => {
            button.addEventListener("click", () => {
                selectedOption = button.dataset.option;
                renderOptions();
                updateChance();
            });
        });
    }

    function updateChance() {
        const chanceElement = document.getElementById("upgrade-chance");
        const info = document.getElementById("upgrade-info");
        const prize = document.getElementById("upgrade-prize");
        const button = document.getElementById("upgrade-button");
        const wheel = document.getElementById("upgrade-wheel");

        if (!chanceElement || !info || !button || !wheel) return;

        const config = getOption();

        if (!config) return;

        chanceElement.textContent = config.chance + "%";

        wheel.style.background = `
            conic-gradient(
                from 0deg,
                #32d47b 0%,
                #32d47b ${config.chance}%,
                #29364d ${config.chance}%,
                #29364d 100%
            )
        `;

        if (selectedSource) {
            const expectedPrice = Math.round(
                selectedSource.price * config.multiplier
            );

            prize.textContent = money(expectedPrice) + " DC";

            info.textContent =
                "Ставка: " + money(selectedSource.price) +
                " DC. Примерный множитель: x" +
                config.multiplier;
        } else {
            prize.textContent = "0 DC";
            info.textContent = "Сначала выбери свой скин.";
        }

        if (busy) {
            button.disabled = true;
            button.textContent = "СТРЕЛКА КРУТИТСЯ...";
            return;
        }

        button.textContent = "⚡ АПГРЕЙД";
        button.disabled = !selectedSource;
    }

    async function spin(roll) {
        const pointer = document.getElementById("upgrade-pointer");

        if (!pointer) return;

        pointer.style.transition = "none";
        pointer.style.transform = "rotate(0deg)";

        void pointer.offsetWidth;

        const angle = Number(roll) * 3.6;
        const finalAngle = 360 * 5 + angle;

        await new Promise(resolve => {
            requestAnimationFrame(() => {
                pointer.style.transition =
                    "transform 4.6s cubic-bezier(.12,.65,.12,1)";

                pointer.style.transform =
                    "rotate(" + finalAngle + "deg)";

                setTimeout(resolve, 4800);
            });
        });
    }

    async function performUpgrade() {
        if (busy || !selectedSource) return;

        const config = getOption();
        if (!config) return;

        const sourceId = selectedSource.id;
        const mode = selectedMode;
        const option = selectedOption;

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
                    mode: mode,
                    option: option
                })
            });

            if (!result.success) {
                throw new Error(result.error || "Ошибка апгрейда");
            }

            await spin(result.roll);

            const message = result.won
                ? "🎉 ПОБЕДА! Ты получил " +
                  result.target.name +
                  " за " + money(result.target.price) + " DC!"
                : "❌ НЕУДАЧА! Скин " +
                  result.source.name +
                  " сгорел. Стрелка остановилась вне зелёной зоны.";

            busy = false;
            selectedSource = null;

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
            const inventoryData = await apiRequest("/api/inventory");

            inventory = (inventoryData.inventory || []).map(skin => ({
                id: Number(skin.skin_id),
                name: skin.name,
                rarity: skin.rarity,
                price: Number(skin.price),
                quantity: Number(skin.quantity)
            })).filter(skin =>
                skin.id > 0 &&
                skin.price > 0 &&
                skin.quantity > 0
            );

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

        if (oldRoot) oldRoot.remove();

        const placeholder = page.querySelector(".placeholder");
        if (placeholder) placeholder.remove();

        const root = document.createElement("div");
        root.id = "upgrade-app";
        page.appendChild(root);

        selectedSource = null;
        selectedMode = "multiplier";
        selectedOption = "x2";
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
