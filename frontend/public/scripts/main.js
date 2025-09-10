import { renderTable, openCreate, bindForm } from './table.js';

const promptBox=document.getElementById('prompt');
const expandBtn=document.getElementById('expandBtn');
const actionBtn=document.getElementById('actionBtn');
const resultPane=document.getElementById('resultPane');
const summaryBox=document.getElementById('summaryBox');
const selectedTableBody=document.querySelector('#selectedTable tbody');

// Tabs
const tabButtons=[...document.querySelectorAll('.tab')];
const tabSummary=document.getElementById('tab-summary');
const tabSelected=document.getElementById('tab-selected');

let filterText='';

async function boot(){
  // Search on top-right of table
  document.getElementById('searchInput').addEventListener('input', ()=>{
    filterText=document.getElementById('searchInput').value.trim().toLowerCase();
    renderTable(filterText);
  });

  // Add + Modal
  document.getElementById('addBtn').addEventListener('click', openCreate);
  bindForm(()=> renderTable(filterText));
  await renderTable();

  // Prompt expand only
  expandBtn.addEventListener('click', ()=> promptBox.classList.toggle('expanded'));
  // Analyze triggers backend then show tabs
  actionBtn.addEventListener('click', analyze);

  // Tabs behavior
  tabButtons.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      tabButtons.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const t=btn.dataset.tab;
      tabSummary.classList.toggle('hidden', t!=='summary');
      tabSelected.classList.toggle('hidden', t!=='selected');
    });
  });
}
boot();

async function analyze(){
  const text=promptBox.value.trim();
  if(!text) return;

  // demo data; replace with real API when ready
  const matches=Array.from({length:12}).map((_,i)=>({
    name:`Demo ${i+1}`,price:1000000+i*100000,rooms:(i%4)+1,size:60+i*5,city:'Cairo'
  }));

  summaryBox.textContent = [
    `Request: ${text}`,
    `Candidates: ${matches.length}`,
    `Note: replace with backend explanation here.`
  ].join('\n');

  selectedTableBody.innerHTML='';
  matches.forEach((m,i)=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${i+1}</td><td>${m.name}</td><td>${m.price}</td><td>${m.rooms}</td><td>${m.size}</td><td>${m.city}</td>`;
    selectedTableBody.appendChild(tr);
  });

  resultPane.hidden=false;
  // default to show "selected table" after action
  document.querySelector('.tab.active')?.classList.remove('active');
  document.querySelector('.tab[data-tab="selected"]').classList.add('active');
  tabSummary.classList.add('hidden');
  tabSelected.classList.remove('hidden');
}
