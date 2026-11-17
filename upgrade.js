
(() => {
 "use strict";

 const app = window.NFT_CASE;

 if (!app) {
  console.error("NFT_CASE не найден");
  return;
 }

 const Upgrade = {
  inventory: [],
  catalog: [],
  multipliers: {},
  mode: "multiplier",
  multiplier: 2,

  escape(value) {
   return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
   }[char]));
  },

  backgroundName(value) {
   return ({
    normal: "Normal",
    gold: "Gold",
    onyx_black: "Onyx Black",
    black: "Black"
   })[value] || "Normal";
  },

  getBackgroundMultiplier(background) {
   return ({
    normal: 1,
    gold: 3,
    onyx_black: 5,
    black: 10
   })[background] || 1;
  },

  getChanceValue() {
   const value = Number(
    document.getElementById("upgradeChance").value
   );

   return Math.min(90, Math.max(5, value || 5));
  },

  getMultiplierChance() {
   const item = Array.isArray(this.multipliers)
    ? this.multipliers.find(x =>
       Number(x.value) === this.multiplier
      )
    : null;

   const chance = Number(
    item?.chance ?? 100 / this.multiplier
   );

   return chance > 1 ? chance / 100 : chance;
  },

  async load() {
   try {
    const data = await app.request("/api/upgrade/options");

    this.inventory = data.inventory || [];
    this.catalog = data.catalog || [];
    this.multipliers = data.multipliers || [];

    this.renderSource();
    this.renderTargets();
    this.updateInfo();
   } catch (error) {
    console.error("Ошибка загрузки апгрейда:", error);
    app.notice(error.message || "Не удалось загрузить апгрейд");
   }
  },

  renderSource() {
   const select = document.getElementById("upgradeSource");
   const previous = select.value;

   if (!this.inventory.length) {
    select.innerHTML = '<option value="">Инвентарь пуст</option>';
    return;
   }

   select.innerHTML =
    '<option value="">Выбери NFT</option>' +
    this.inventory.map(item => `
     <option value="${Number(item.inventory_id)}">
      ${this.escape(item.name || item.code)} —
      ${app.format(item.final_price)}
      (${this.backgroundName(item.background)})
     </option>
    `).join("");

   if (previous && this.inventory.some(x =>
    String(x.inventory_id) === previous
   )) {
    select.value = previous;
   }
  },

  getSource() {
   const id = Number(
    document.getElementById("upgradeSource").value
   );

   return this.inventory.find(item =>
    Number(item.inventory_id) === id
   ) || null;
  },

  getTargetBackground() {
   return document.getElementById("upgradeBackground").value;
  },

  getPriceRange() {
   const source = this.getSource();

   if (!source) {
    return { min: 0, max: 0, desired: 0 };
   }

   const sourcePrice = Number(source.final_price || 0);
   const backgroundMultiplier = this.getBackgroundMultiplier(
    this.getTargetBackground()
   );

   let min;
   let max;
   let desired;

   if (this.mode === "multiplier") {
    const expected = sourcePrice * this.multiplier;

    min = expected * 0.75;
    max = expected * 1.25;
    desired = expected;
   } else {
    min = sourcePrice * 2;
    max = sourcePrice * 10;

    const chance = this.getChanceValue();

    const ratio = Math.min(
     10,
     Math.max(2, 100 / chance)
    );

    desired = sourcePrice * ratio;
   }

   return {
    min: min / backgroundMultiplier,
    max: max / backgroundMultiplier,
    desired: desired / backgroundMultiplier
   };
  },

  renderTargets() {
   const select = document.getElementById("upgradeTarget");
   const source = this.getSource();

   if (!source) {
    select.innerHTML =
     '<option value="">Сначала выбери исходный NFT</option>';
    return;
   }

   const range = this.getPriceRange();
   const previous = select.value;

   const candidates = this.catalog
    .filter(item => {
     const price = Number(item.base_price || 0);

     return price > 0 &&
      price >= range.min &&
      price <= range.max;
    })
    .map(item => ({
     ...item,
     distance: Math.abs(
      Number(item.base_price) - range.desired
     )
    }))
    .sort((a, b) => a.distance - b.distance);

   if (!candidates.length) {
    select.innerHTML =
     '<option value="">Нет NFT подходящей стоимости</option>';
    return;
   }

   select.innerHTML =
    '<option value="">Выбери желаемый NFT</option>' +
    candidates.map(item => `
     <option value="${Number(item.id)}">
      ${this.escape(item.name || item.code)} —
      ${app.format(item.base_price)}
     </option>
    `).join("");

   if (previous && candidates.some(x =>
    String(x.id) === previous
   )) {
    select.value = previous;
   }
  },

  updateInfo() {
   const source = this.getSource();
   const info = document.getElementById("upgradeInfo");

   if (!source) {
    info.textContent = "Выбери NFT для начала";
    return;
   }

   const sourcePrice = Number(source.final_price || 0);
   const range = this.getPriceRange();

   const chance = this.mode === "multiplier"
    ? this.getMultiplierChance() * 100
    : this.getChanceValue();

   const selectedId = Number(
    document.getElementById("upgradeTarget").value
   );

   const target = this.catalog.find(x =>
    Number(x.id) === selectedId
   );

   const targetPrice = target
    ? Number(target.base_price) *
      this.getBackgroundMultiplier(this.getTargetBackground())
    : 0;

   info.innerHTML = `
    <div style="display:grid;gap:7px">
     <div class="row">
      <span>Стоимость твоего NFT</span>
      <strong>${app.format(sourcePrice)}</strong>
     </div>

     <div class="row">
      <span>Подходящая стоимость цели</span>
      <strong>
       ${app.format(range.min * this.getBackgroundMultiplier(this.getTargetBackground()))}
       —
       ${app.format(range.max * this.getBackgroundMultiplier(this.getTargetBackground()))}
      </strong>
     </div>

     <div class="row">
      <span>Шанс победы</span>
      <strong style="color:#bbaaff">
       ${chance.toFixed(2)}%
      </strong>
     </div>

     ${target ? `
      <div class="row">
       <span>Выбранная цель</span>
       <strong>${this.escape(target.name || target.code)}</strong>
      </div>

      <div class="row">
       <span>Итоговая стоимость</span>
       <strong>${app.format(targetPrice)}</strong>
      </div>
     ` : ""}
    </div>

    <div style="margin-top:10px;font-size:11px;color:#858b9c">
     При проигрыше исходный NFT сгорает.
    </div>
   `;
  },

  async play() {
   const source = this.getSource();

   if (!source) {
    app.notice("Сначала выбери свой NFT");
    return;
   }

   const targetId = Number(
    document.getElementById("upgradeTarget").value
   );

   if (!targetId) {
    app.notice("Выбери NFT, который хочешь получить");
    return;
   }

   const target = this.catalog.find(x =>
    Number(x.id) === targetId
   );

   if (!target) {
    app.notice("Целевой NFT не найден");
    return;
   }

   const background = this.getTargetBackground();
   const range = this.getPriceRange();

   const finalTargetPrice =
    Number(target.base_price) *
    this.getBackgroundMultiplier(background);

   if (
    finalTargetPrice < range.min *
     this.getBackgroundMultiplier(background) ||
    finalTargetPrice > range.max *
     this.getBackgroundMultiplier(background)
   ) {
    app.notice("Стоимость выбранного NFT не подходит");
    return;
   }

   const body = {
    inventory_id: Number(source.inventory_id),
    target_nft_id: targetId,
    target_background: background,
    mode: this.mode
   };

   if (this.mode === "multiplier") {
    body.multiplier = this.multiplier;
   } else {
    body.chance = this.getChanceValue();
   }

   const button = document.getElementById("upgradeButton");
   button.disabled = true;
   button.textContent = "АПГРЕЙД...";

   try {
    const result = await app.request("/api/upgrade", {
     method: "POST",
     body: JSON.stringify(body)
    });

    if (result.won) {
     app.showModal(`
      <div style="clear:both;text-align:center;padding-top:15px">
       <div style="font-size:65px">🎉</div>
       <h2 style="color:#48d69a;margin:10px 0">
        АПГРЕЙД УДАЛСЯ!
       </h2>

       <p style="margin:10px 0">
        ${this.escape(result.message || "Ты получил новый NFT!")}
       </p>

       ${result.reward ? `
        <div class="result-item">
         <strong>${this.escape(result.reward.name || "NFT")}</strong>
         <div class="muted small">
          ${app.format(result.reward.price)}
         </div>
        </div>
       ` : ""}

       <button class="primary" id="upgradeResultClose">
        Продолжить
       </button>
      </div>
     `);
    } else {
     app.showModal(`
      <div style="clear:both;text-align:center;padding-top:15px">
       <div style="font-size:65px">💔</div>

       <h2 style="color:#ff8294;margin:10px 0">
        НЕ ПОВЕЗЛО
       </h2>

       <p class="muted" style="margin:10px 0">
        ${this.escape(result.message || "Исходный NFT сгорел")}
       </p>

       <button class="primary" id="upgradeResultClose">
        Понятно
       </button>
      </div>
     `);
    }

    document.getElementById("upgradeResultClose").onclick = () => {
     app.closeModal();
    };

    await this.load();
    await window.Profile?.load();
    await window.Craft?.load();

   } catch (error) {
    app.notice(error.message || "Ошибка апгрейда");
   } finally {
    button.disabled = false;
    button.textContent = "ПРОКАЧАТЬ NFT";
   }
  },

  init() {
   document.getElementById("upgradeModes")
    .querySelectorAll("button").forEach(button => {
     button.onclick = () => {
      const selectedMode = button.dataset.mode;

      this.mode = selectedMode === "chance"
       ? "percent"
       : selectedMode;

      document.querySelectorAll("#upgradeModes button")
       .forEach(x =>
        x.classList.toggle("selected", x === button)
       );

      document.getElementById("multiplierTabs").style.display =
       this.mode === "multiplier" ? "flex" : "none";

      document.getElementById("chanceControls").style.display =
       this.mode === "percent" ? "block" : "none";

      this.renderTargets();
      this.updateInfo();
     };
    });

   document.getElementById("multiplierTabs")
    .querySelectorAll("button").forEach(button => {
     button.onclick = () => {
      this.multiplier = Number(button.dataset.multiplier);

      document.querySelectorAll("#multiplierTabs button")
       .forEach(x =>
        x.classList.toggle("selected", x === button)
       );

      this.renderTargets();
      this.updateInfo();
     };
    });

   document.getElementById("upgradeSource").onchange = () => {
    this.renderTargets();
    this.updateInfo();
   };

   document.getElementById("upgradeBackground").onchange = () => {
    this.renderTargets();
    this.updateInfo();
   };

   document.getElementById("upgradeChance").oninput = () => {
    this.renderTargets();
    this.updateInfo();
   };

   document.getElementById("upgradeTarget").onchange = () => {
    this.updateInfo();
   };

   document.getElementById("upgradeButton").onclick = () => {
    this.play();
   };
  }
 };

 window.Upgrade = Upgrade;
 Upgrade.init();
})();
