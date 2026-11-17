
(() => {
 "use strict";

 const app = window.NFT_CASE;

 if (!app) {
  console.error("NFT_CASE не найден");
  return;
 }

 const Craft = {
  inventory: [],
  selected: new Set(),
  required: 5,

  escape(value) {
   return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
   }[char]));
  },

  async load() {
   try {
    const data = await app.request("/api/craft/options");

    this.inventory = data.inventory || [];
    this.required = Number(data.required_items) || 5;

    const availableIds = new Set(
     this.inventory.map(item => Number(item.inventory_id))
    );

    this.selected = new Set(
     [...this.selected].filter(id => availableIds.has(id))
    );

    this.render();
   } catch (error) {
    console.error("Ошибка загрузки крафта:", error);
    app.notice(error.message || "Не удалось загрузить крафт");
   }
  },

  getSelectedItems() {
   return this.inventory.filter(item =>
    this.selected.has(Number(item.inventory_id))
   );
  },

  getTotal() {
   return this.getSelectedItems().reduce((sum, item) => {
    return sum + Number(item.final_price || 0);
   }, 0);
  },

  render() {
   const container = document.getElementById("craftInventory");

   document.getElementById("craftSelectedCount").textContent =
    `${this.selected.size}/${this.required}`;

   document.getElementById("craftTotal").textContent =
    app.format(this.getTotal());

   const button = document.getElementById("craftButton");

   button.disabled = this.selected.size !== this.required;

   if (!this.inventory.length) {
    container.innerHTML =
     '<div class="empty">У тебя пока нет NFT для крафта</div>';
    return;
   }

   container.innerHTML = this.inventory.map(item => {
    const id = Number(item.inventory_id);
    const checked = this.selected.has(id) ? "checked" : "";
    const name = this.escape(item.name || item.code || "NFT");

    return `
     <label class="item-select">
      <input
       type="checkbox"
       data-craft-id="${id}"
       ${checked}
      >
      <div class="item-select-info">
       <strong>${name}</strong>
       <span>
        ${this.escape(item.background || "normal")}
        · ${app.format(item.final_price)}
       </span>
      </div>
     </label>
    `;
   }).join("");

   container.querySelectorAll("[data-craft-id]").forEach(input => {
    input.addEventListener("change", () => {
     const id = Number(input.dataset.craftId);

     if (input.checked) {
      if (this.selected.size >= this.required) {
       input.checked = false;
       app.notice(`Можно выбрать только ${this.required} NFT`);
       return;
      }

      this.selected.add(id);
     } else {
      this.selected.delete(id);
     }

     this.render();
    });
   });
  },

  async play() {
   if (this.selected.size !== this.required) {
    app.notice(`Выбери ровно ${this.required} NFT`);
    return;
   }

   const ids = [...this.selected];

   if (new Set(ids).size !== this.required) {
    app.notice("Нельзя выбрать один NFT несколько раз");
    return;
   }

   const total = this.getTotal();

   if (!confirm(
    `Отправить ${this.required} NFT в крафт?\n` +
    `Их общая стоимость: ${app.format(total)}\n\n` +
    `Все выбранные предметы будут сожжены.`
   )) {
    return;
   }

   const button = document.getElementById("craftButton");

   button.disabled = true;
   button.textContent = "СОЗДАНИЕ...";

   try {
    const result = await app.request("/api/craft", {
     method: "POST",
     body: JSON.stringify({
      inventory_ids: ids
     })
    });

    this.selected.clear();

    const reward = result.reward || {};

    const rewardName = this.escape(
     reward.name || "Новый NFT"
    );

    const rewardPrice = reward.final_price ??
     reward.price ??
     reward.reward_price ??
     0;

    const image = reward.image_url
     ? `<img src="${this.escape(reward.image_url)}" style="width:100%;height:170px;object-fit:contain">`
     : '<div style="font-size:75px;padding:25px">🎁</div>';

    app.showModal(`
     <div style="clear:both;text-align:center;padding-top:15px">
      <div style="font-size:45px">✨</div>
      <h2 style="margin:10px 0;color:#bbaaff">КРАФТ УСПЕШЕН!</h2>
      <p class="muted small">Ты получил новый NFT</p>
      ${image}
      <div class="result-item">
       <strong>${rewardName}</strong>
       <div class="muted small">
        ${app.format(rewardPrice)}
       </div>
      </div>
      <button class="primary" id="craftResultClose">
       ЗАБРАТЬ NFT
      </button>
     </div>
    `);

    document.getElementById("craftResultClose").onclick = () => {
     app.closeModal();
    };

    await this.load();
    await window.Profile?.load();
    await window.Upgrade?.load();

   } catch (error) {
    app.notice(error.message || "Ошибка крафта");
    await this.load();
   } finally {
    button.disabled = this.selected.size !== this.required;
    button.textContent = "СОЗДАТЬ NFT";
   }
  },

  init() {
   document.getElementById("craftButton").onclick = () => {
    this.play();
   };
  }
 };

 window.Craft = Craft;
 Craft.init();
})();
