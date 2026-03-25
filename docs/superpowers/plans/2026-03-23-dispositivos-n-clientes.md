# Dispositivos N:N Clientes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um dispositivo seja associado a N clientes via tabela junction, mantendo `clienteId` como "Cliente Responsável (Faturamento)". A aba dispositivos em cliente-detalhe passa a mostrar TODOS os dispositivos do sistema com status de vínculo.

**Architecture:** Nova tabela `DispositivoCliente { dispositivoId, clienteId }` (chave composta). O campo `Dispositivo.clienteId` permanece inalterado como responsável de faturamento — zero mudanças no código de cobrança. Novos endpoints gerenciam a junction. O `GET /api/clientes/:id/dispositivos` passa a retornar todos os dispositivos com `vinculado: bool`.

**Tech Stack:** Node.js + Express + Prisma + TypeScript (backend); Bootstrap 3 + jQuery + Vanilla JS (frontend)

---

## File Structure

**Modified:**
- `backend/prisma/schema.prisma` — novo model DispositivoCliente + relações
- `backend/src/routes/dispositivos.routes.ts` — novos endpoints, respostas atualizadas
- `backend/src/routes/clientes.routes.ts` — modificar GET /:id/dispositivos
- `AgillockSite/admin/dispositivo.html` — UI multi-cliente
- `AgillockSite/colaborador/dispositivo.html` — UI multi-cliente
- `AgillockSite/admin/cliente-detalhe.html` — aba todos-os-dispositivos
- `AgillockSite/colaborador/cliente-detalhe.html` — aba todos-os-dispositivos
- `AgillockSite/admin/dispositivos.html` — coluna cliente com badge de extras
- `AgillockSite/colaborador/dispositivos.html` — coluna cliente com badge de extras

---

## Task 1: Schema — Adicionar tabela DispositivoCliente

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] Adicionar ao schema, após o model `BoletoDispositivo`:

```prisma
model DispositivoCliente {
  dispositivoId String
  clienteId     String
  dispositivo   Dispositivo @relation(fields: [dispositivoId], references: [id], onDelete: Cascade)
  cliente       Cliente     @relation(fields: [clienteId], references: [id], onDelete: Cascade)
  @@id([dispositivoId, clienteId])
}
```

- [ ] No model `Dispositivo`, adicionar (após `boletosUnificados BoletoDispositivo[]`):
```prisma
  clientesVinculados DispositivoCliente[]
```

- [ ] No model `Cliente`, adicionar (após `dispositivos Dispositivo[]`):
```prisma
  dispositivosVinculados DispositivoCliente[]
```

- [ ] Rodar no terminal (dentro de `backend/`):
```bash
cd backend && npx prisma migrate dev --name add_dispositivo_cliente
```
Esperado: `✓ Generated Prisma Client`

- [ ] Commit:
```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat: adicionar tabela DispositivoCliente (junction n:n)"
```

---

## Task 2: Backend — Modificar GET /api/clientes/:id/dispositivos

**Files:**
- Modify: `backend/src/routes/clientes.routes.ts` (linhas ~273-283)

- [ ] Substituir a implementação atual do endpoint `GET /:id/dispositivos` para retornar TODOS os dispositivos do sistema com flag `vinculado`:

```typescript
// GET /api/clientes/:id/dispositivos
router.get('/:id/dispositivos', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const clienteId = param(req, 'id');
  const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } });
  if (!cliente) { res.status(404).json({ error: 'Cliente não encontrado.' }); return; }

  // Buscar IDs vinculados via junction table
  const vinculados = await prisma.dispositivoCliente.findMany({
    where: { clienteId },
    select: { dispositivoId: true },
  });
  const vinculadosSet = new Set(vinculados.map((v) => v.dispositivoId));

  // Buscar todos os dispositivos
  const dispositivos = await prisma.dispositivo.findMany({
    orderBy: { nome: 'asc' },
    select: {
      id: true, nome: true, identificador: true, placa: true,
      categoria: true, ativo: true, clienteId: true,
      cliente: { select: { id: true, nome: true } },
    },
  });

  const result = dispositivos.map((d) => ({
    ...d,
    vinculado: vinculadosSet.has(d.id),
  }));

  res.json(result);
});
```

- [ ] Commit:
```bash
git add backend/src/routes/clientes.routes.ts
git commit -m "feat: GET /api/clientes/:id/dispositivos retorna todos com flag vinculado"
```

---

## Task 3: Backend — Novos endpoints de junction (POST/DELETE)

**Files:**
- Modify: `backend/src/routes/dispositivos.routes.ts`

- [ ] Adicionar endpoint `POST /api/dispositivos/:id/clientes` logo após o endpoint `PATCH /:id/vincular` (linha ~309):

```typescript
// ─── POST /api/dispositivos/:id/clientes — Vincular cliente extra ──────────
router.post('/:id/clientes', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const dispositivoId = param(req, 'id');
  const { clienteId } = req.body;

  if (!clienteId) {
    res.status(400).json({ error: 'clienteId é obrigatório.' });
    return;
  }

  const [existe, clienteExiste] = await Promise.all([
    prisma.dispositivo.findUnique({ where: { id: dispositivoId }, select: { id: true } }),
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } }),
  ]);
  if (!existe) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }
  if (!clienteExiste) { res.status(404).json({ error: 'Cliente não encontrado.' }); return; }

  await prisma.dispositivoCliente.upsert({
    where: { dispositivoId_clienteId: { dispositivoId, clienteId } },
    create: { dispositivoId, clienteId },
    update: {},
  });

  res.status(201).json({ dispositivoId, clienteId });
});

// ─── DELETE /api/dispositivos/:id/clientes/:clienteId — Desvincular extra ──
router.delete('/:id/clientes/:clienteId', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeDesvincularDispositivo) {
    res.status(403).json({ error: 'Sem permissão para desvincular dispositivos de clientes.' });
    return;
  }
  const dispositivoId = param(req, 'id');
  const clienteId = req.params.clienteId;

  await prisma.dispositivoCliente.deleteMany({
    where: { dispositivoId, clienteId },
  });

  res.status(204).send();
});
```

- [ ] Atualizar `GET /api/dispositivos/:id` (linha ~67) para incluir `clientesVinculados`:

No `include`, adicionar:
```typescript
clientesVinculados: {
  include: { cliente: { select: { id: true, nome: true } } },
},
```

- [ ] Atualizar `GET /api/dispositivos` (lista, linha ~44) para incluir contagem de extras:

No `include`, adicionar:
```typescript
_count: { select: { clientesVinculados: true } },
```

- [ ] Commit:
```bash
git add backend/src/routes/dispositivos.routes.ts
git commit -m "feat: endpoints POST/DELETE /api/dispositivos/:id/clientes e inclui clientesVinculados nas respostas"
```

---

## Task 4: Backend — POST/PUT dispositivos sincroniza clientesExtras

**Files:**
- Modify: `backend/src/routes/dispositivos.routes.ts`

- [ ] No handler `POST /api/dispositivos` (linha ~88), após o `prisma.dispositivo.create`, adicionar sincronização:

```typescript
// Sincronizar clientes extras (junction)
const clientesExtrasRaw = req.body.clientesExtras;
if (clientesExtrasRaw) {
  let extras: string[] = [];
  try { extras = JSON.parse(clientesExtrasRaw); } catch { extras = []; }
  if (extras.length) {
    await prisma.dispositivoCliente.createMany({
      data: extras.map((cId: string) => ({ dispositivoId: dispositivo.id, clienteId: cId })),
      skipDuplicates: true,
    });
  }
}
```

- [ ] No handler `PUT /api/dispositivos/:id` (linha ~163), após o `prisma.dispositivo.update`, adicionar sincronização:

```typescript
// Sincronizar clientes extras (junction) — substitui todos
const clientesExtrasRaw = req.body.clientesExtras;
if (clientesExtrasRaw !== undefined) {
  let extras: string[] = [];
  try { extras = JSON.parse(clientesExtrasRaw); } catch { extras = []; }
  await prisma.dispositivoCliente.deleteMany({ where: { dispositivoId: id } });
  if (extras.length) {
    await prisma.dispositivoCliente.createMany({
      data: extras.map((cId: string) => ({ dispositivoId: id, clienteId: cId })),
      skipDuplicates: true,
    });
  }
}
```

- [ ] Commit:
```bash
git add backend/src/routes/dispositivos.routes.ts
git commit -m "feat: POST/PUT dispositivos sincroniza clientesExtras na junction table"
```

---

## Task 5: Frontend — dispositivo.html (admin) multi-cliente

**Files:**
- Modify: `AgillockSite/admin/dispositivo.html`

### 5a — HTML: renomear label e adicionar seção de clientes vinculados

- [ ] Linha 131: mudar `<label>Cliente</label>` para:
```html
<label>Cliente Responsável (Faturamento)</label>
```

- [ ] Após o fechamento do `<div class="row">` que contém o campo Cliente/Contato (após linha ~146), adicionar nova seção HTML dentro do mesmo `card-section`:

```html
<!-- Clientes Vinculados -->
<div id="clientes-vinculados-section" style="margin-top:18px;">
  <label style="font-weight:600;font-size:13px;">Clientes Vinculados</label>
  <div style="display:flex;gap:8px;align-items:flex-start;">
    <div style="flex:1;position:relative;">
      <input class="form-control" id="cv-busca" placeholder="Digite para buscar cliente..." autocomplete="off" />
      <div id="cv-resultados" style="position:absolute;z-index:200;width:100%;background:white;border:1px solid #ddd;border-radius:4px;max-height:200px;overflow-y:auto;display:none;"></div>
    </div>
    <button type="button" class="btn btn-default btn-sm" id="cv-adicionar" style="white-space:nowrap;"><i class="fa fa-plus"></i> Adicionar</button>
  </div>
  <div id="cv-lista" style="margin-top:10px;display:flex;flex-direction:column;gap:6px;"></div>
</div>
```

### 5b — JS: lógica de clientes vinculados

- [ ] Adicionar variáveis e funções de gestão de `clientesExtras` no bloco `<script>`, logo após a declaração de `var clienteTimer`:

```javascript
// ── Clientes Vinculados (extras) ───────────────────────────────────────────
var clientesExtras = []; // [{id, nome}]
var cvTimer = null;
var cvSelecionado = null;

function renderClientesExtras() {
  var lista = document.getElementById('cv-lista');
  if (!clientesExtras.length) {
    lista.innerHTML = '<small class="text-muted">Nenhum cliente vinculado.</small>';
    return;
  }
  lista.innerHTML = clientesExtras.map(function(c, i) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#f8f9fa;border-radius:6px;border:1px solid #e9ecef;">' +
      '<span style="font-size:13px;">' + esc(c.nome) + '</span>' +
      '<button type="button" class="btn btn-xs btn-danger cv-remover" data-idx="' + i + '" title="Remover"><i class="fa fa-times"></i></button>' +
      '</div>';
  }).join('');
  lista.querySelectorAll('.cv-remover').forEach(function(btn) {
    btn.addEventListener('click', function() {
      clientesExtras.splice(parseInt(this.dataset.idx), 1);
      renderClientesExtras();
    });
  });
}

document.getElementById('cv-busca').addEventListener('input', function() {
  var q = this.value.trim();
  cvSelecionado = null;
  if (q.length < 2) { document.getElementById('cv-resultados').style.display = 'none'; return; }
  clearTimeout(cvTimer);
  cvTimer = setTimeout(function() {
    AL.apiGet('/api/clientes?busca=' + encodeURIComponent(q))
      .then(function(list) {
        var div = document.getElementById('cv-resultados');
        if (!list.length) { div.innerHTML = '<div style="padding:10px;color:#999;">Nenhum cliente encontrado.</div>'; div.style.display = 'block'; return; }
        div.innerHTML = list.map(function(c) {
          return '<div class="cv-item" data-id="' + c.id + '" data-nome="' + esc(c.nome) + '" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f0f2f5;">' + esc(c.nome) + '</div>';
        }).join('');
        div.style.display = 'block';
        div.querySelectorAll('.cv-item').forEach(function(item) {
          item.addEventListener('click', function() {
            cvSelecionado = { id: this.dataset.id, nome: this.dataset.nome };
            document.getElementById('cv-busca').value = this.dataset.nome;
            div.style.display = 'none';
          });
        });
      }).catch(function(){});
  }, 300);
});

document.addEventListener('click', function(e) {
  var wrap = document.getElementById('cv-busca').parentNode;
  if (!wrap.contains(e.target)) document.getElementById('cv-resultados').style.display = 'none';
});

document.getElementById('cv-adicionar').addEventListener('click', function() {
  if (!cvSelecionado) { AL.showAlert('Selecione um cliente na lista.'); return; }
  var jaExiste = clientesExtras.some(function(c) { return c.id === cvSelecionado.id; });
  if (jaExiste) { AL.showAlert('Este cliente já está na lista.'); return; }
  clientesExtras.push(cvSelecionado);
  cvSelecionado = null;
  document.getElementById('cv-busca').value = '';
  renderClientesExtras();
});

renderClientesExtras();
```

- [ ] No `preencherForm(d)`, após o bloco de clienteId (linha ~583), adicionar:

```javascript
// Carregar clientes vinculados extras
clientesExtras = (d.clientesVinculados || []).map(function(v) {
  return { id: v.clienteId, nome: v.cliente ? v.cliente.nome : v.clienteId };
});
renderClientesExtras();
```

- [ ] No handler de salvar (linha ~662), após `formData.append('clienteId', ...)`:

```javascript
formData.append('clientesExtras', JSON.stringify(clientesExtras.map(function(c){ return c.id; })));
```

- [ ] Commit:
```bash
git add AgillockSite/admin/dispositivo.html
git commit -m "feat: admin/dispositivo.html suporte a múltiplos clientes vinculados"
```

---

## Task 6: Frontend — dispositivo.html (colaborador) multi-cliente

**Files:**
- Modify: `AgillockSite/colaborador/dispositivo.html`

- [ ] Aplicar as mesmas mudanças do Task 5 (label, seção HTML, JS de clientesExtras)
- [ ] Observação: o colaborador também tem verificação de permissão `canDesvincularDispositivo` no campo de cliente responsável — manter esse comportamento intacto
- [ ] Commit:
```bash
git add AgillockSite/colaborador/dispositivo.html
git commit -m "feat: colaborador/dispositivo.html suporte a múltiplos clientes vinculados"
```

---

## Task 7: Frontend — cliente-detalhe.html (admin) aba dispositivos

**Files:**
- Modify: `AgillockSite/admin/cliente-detalhe.html` (função `renderDispositivos`, linhas 462-534)

- [ ] Mudar `renderDispositivos` para buscar TODOS os dispositivos via `GET /api/clientes/:id/dispositivos` (ao invés de usar `c.dispositivos`):

```javascript
function renderDispositivos() {
  var div = document.getElementById('tab-dispositivos');
  div.innerHTML = '<div class="text-center" style="padding:40px;color:#999;"><i class="fa fa-spinner fa-spin fa-2x"></i></div>';
  AL.apiGet('/api/clientes/' + clienteId + '/dispositivos')
    .then(function(dispositivos) {
      var addUrl = 'dispositivo.html?clienteId=' + clienteId + '&back=cliente-detalhe.html%3Fid%3D' + clienteId;
      var html = '<div class="card-section">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
        '<h5 style="margin:0;font-weight:700;">Dispositivos</h5>' +
        '<a href="' + addUrl + '" class="btn btn-sm btn-primary-al"><i class="fa fa-plus"></i> Adicionar Dispositivo</a></div>';
      if (!dispositivos.length) {
        html += '<p class="text-muted text-center" style="padding:20px 0;">Nenhum dispositivo cadastrado.</p>';
      } else {
        html += dispositivos.map(function(d) {
          var vinculadoBadge = d.vinculado
            ? '<span class="al-badge badge-ativo" style="font-size:11px;"><i class="fa fa-link"></i> Vinculado</span>'
            : '<span class="al-badge badge-inativo" style="font-size:11px;"><i class="fa fa-chain-broken"></i> Desvinculado</span>';
          var statusBadge = d.ativo ? AL.badgeStatus('ATIVO') : AL.badgeStatus('INATIVO');
          var btnVincDesvincular = d.vinculado
            ? '<button class="btn btn-xs btn-warning btn-desv-disp" data-did="' + d.id + '" title="Desvincular"><i class="fa fa-chain-broken"></i> Desvincular</button>'
            : '<button class="btn btn-xs btn-success btn-vinc-disp" data-did="' + d.id + '" title="Vincular"><i class="fa fa-link"></i> Vincular</button>';
          return '<div class="placa-item"><div>' +
            '<strong>' + esc(d.identificador) + '</strong>' +
            (d.cliente ? '<small class="text-muted" style="margin-left:8px;">Resp.: ' + esc(d.cliente.nome) + '</small>' : '') +
            '<br><small class="text-muted">' + esc(d.nome) + (d.placa ? ' &mdash; <strong>' + esc(d.placa) + '</strong>' : '') + '</small>' +
            '</div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
            vinculadoBadge + statusBadge +
            '<a href="dispositivo.html?id=' + d.id + '&back=cliente-detalhe.html%3Fid%3D' + clienteId + '" class="btn btn-xs btn-default" title="Editar"><i class="fa fa-pencil"></i></a>' +
            '<button class="btn btn-xs ' + (d.ativo ? 'btn-warning' : 'btn-success') + ' btn-toggle-disp" data-did="' + d.id + '" title="' + (d.ativo?'Inativar':'Ativar') + '"><i class="fa fa-power-off"></i></button>' +
            btnVincDesvincular +
            (isAdmin ? '<button class="btn btn-xs btn-danger btn-del-disp" data-did="' + d.id + '" title="Excluir"><i class="fa fa-trash"></i></button>' : '') +
            '</div></div>';
        }).join('');
      }
      html += '</div>';
      div.innerHTML = html;

      div.querySelectorAll('.btn-toggle-disp').forEach(function(btn) {
        btn.addEventListener('click', function() {
          AL.apiPatch('/api/dispositivos/' + this.dataset.did + '/status', {})
            .then(function() { renderDispositivos(); })
            .catch(function(err) { AL.showAlert(err.message); });
        });
      });

      div.querySelectorAll('.btn-vinc-disp').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var did = this.dataset.did;
          AL.apiPost('/api/dispositivos/' + did + '/clientes', { clienteId: clienteId })
            .then(function() { renderDispositivos(); })
            .catch(function(err) { AL.showAlert(err.message); });
        });
      });

      div.querySelectorAll('.btn-desv-disp').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var did = this.dataset.did;
          AL.confirmar({
            titulo: 'Desvincular Dispositivo',
            mensagem: 'Deseja desvincular este dispositivo deste cliente?',
            consequencias: 'O dispositivo ficará sem vínculo com este cliente mas não será excluído.',
            btnTexto: '<i class="fa fa-chain-broken"></i> Desvincular',
          }).then(function(ok) {
            if (!ok) return;
            AL.apiDelete('/api/dispositivos/' + did + '/clientes/' + clienteId)
              .then(function() { renderDispositivos(); })
              .catch(function(err) { AL.showAlert(err.message); });
          });
        });
      });

      if (isAdmin) {
        div.querySelectorAll('.btn-del-disp').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var did = this.dataset.did;
            AL.confirmar({
              titulo: 'Excluir Dispositivo',
              mensagem: 'Deseja excluir este dispositivo?',
              consequencias: 'O dispositivo será removido permanentemente.',
              btnTexto: '<i class="fa fa-trash"></i> Excluir',
            }).then(function(ok) {
              if (!ok) return;
              AL.apiDelete('/api/dispositivos/' + did)
                .then(function() { renderDispositivos(); })
                .catch(function(err) { AL.showAlert(err.message); });
            });
          });
        });
      }
    })
    .catch(function(err) {
      document.getElementById('tab-dispositivos').innerHTML =
        '<div class="text-danger" style="padding:24px;">' + err.message + '</div>';
    });
}
```

- [ ] Verificar onde `renderDispositivos(c)` é chamado (recebe `c` como parâmetro) e mudar para `renderDispositivos()` sem parâmetro.

- [ ] Commit:
```bash
git add AgillockSite/admin/cliente-detalhe.html
git commit -m "feat: admin/cliente-detalhe — aba dispositivos mostra todos com vincular/desvincular"
```

---

## Task 8: Frontend — cliente-detalhe.html (colaborador) aba dispositivos

**Files:**
- Modify: `AgillockSite/colaborador/cliente-detalhe.html` (função `renderDispositivos`, linhas 609-681)

- [ ] Aplicar a mesma lógica do Task 7, adaptando para usar as permissões:
  - `canEditarDispositivo` controla botão de editar
  - `canInativarDispositivo` controla botão toggle
  - `canDesvincularDispositivo` controla botão desvincular
  - `canCriarDispositivo` controla botão Adicionar Dispositivo
  - `canDeleteDispositivo` controla botão excluir

```javascript
function renderDispositivos() {
  var div = document.getElementById('tab-dispositivos');
  div.innerHTML = '<div class="text-center" style="padding:40px;color:#999;"><i class="fa fa-spinner fa-spin fa-2x"></i></div>';
  AL.apiGet('/api/clientes/' + clienteId + '/dispositivos')
    .then(function(dispositivos) {
      var addUrl = 'dispositivo.html?clienteId=' + clienteId + '&back=cliente-detalhe.html%3Fid%3D' + clienteId;
      var html = '<div class="card-section">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
        '<h5 style="margin:0;font-weight:700;">Dispositivos</h5>' +
        (canCriarDispositivo ? '<a href="' + addUrl + '" class="btn btn-sm btn-primary-al"><i class="fa fa-plus"></i> Adicionar Dispositivo</a>' : '') +
        '</div>';
      if (!dispositivos.length) {
        html += '<p class="text-muted text-center" style="padding:20px 0;">Nenhum dispositivo cadastrado.</p>';
      } else {
        html += dispositivos.map(function(d) {
          var vinculadoBadge = d.vinculado
            ? '<span class="al-badge badge-ativo" style="font-size:11px;"><i class="fa fa-link"></i> Vinculado</span>'
            : '<span class="al-badge badge-inativo" style="font-size:11px;"><i class="fa fa-chain-broken"></i> Desvinculado</span>';
          var statusBadge = d.ativo ? AL.badgeStatus('ATIVO') : AL.badgeStatus('INATIVO');
          var btnVincDesvincular = d.vinculado
            ? (canDesvincularDispositivo ? '<button class="btn btn-xs btn-warning btn-desv-disp" data-did="' + d.id + '" title="Desvincular"><i class="fa fa-chain-broken"></i> Desvincular</button>' : '')
            : '<button class="btn btn-xs btn-success btn-vinc-disp" data-did="' + d.id + '" title="Vincular"><i class="fa fa-link"></i> Vincular</button>';
          return '<div class="placa-item"><div>' +
            '<strong>' + esc(d.identificador) + '</strong>' +
            (d.cliente ? '<small class="text-muted" style="margin-left:8px;">Resp.: ' + esc(d.cliente.nome) + '</small>' : '') +
            '<br><small class="text-muted">' + esc(d.nome) + (d.placa ? ' &mdash; Placa: <strong>' + esc(d.placa) + '</strong>' : '') + '</small>' +
            '</div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
            vinculadoBadge + statusBadge +
            (canEditarDispositivo ? '<a href="dispositivo.html?id=' + d.id + '&back=cliente-detalhe.html%3Fid%3D' + clienteId + '" class="btn btn-xs btn-default" title="Editar"><i class="fa fa-pencil"></i></a>' : '') +
            (canInativarDispositivo ? '<button class="btn btn-xs ' + (d.ativo ? 'btn-warning' : 'btn-success') + ' btn-toggle-disp" data-did="' + d.id + '" title="' + (d.ativo?'Inativar':'Ativar') + '"><i class="fa fa-power-off"></i></button>' : '') +
            btnVincDesvincular +
            (canDeleteDispositivo ? '<button class="btn btn-xs btn-danger btn-del-disp" data-did="' + d.id + '" title="Excluir"><i class="fa fa-trash"></i></button>' : '') +
            '</div></div>';
        }).join('');
      }
      html += '</div>';
      div.innerHTML = html;

      div.querySelectorAll('.btn-toggle-disp').forEach(function(btn) {
        btn.addEventListener('click', function() {
          AL.apiPatch('/api/dispositivos/' + this.dataset.did + '/status', {})
            .then(function() { renderDispositivos(); })
            .catch(function(err) { AL.showAlert(err.message); });
        });
      });

      div.querySelectorAll('.btn-vinc-disp').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var did = this.dataset.did;
          AL.apiPost('/api/dispositivos/' + did + '/clientes', { clienteId: clienteId })
            .then(function() { renderDispositivos(); })
            .catch(function(err) { AL.showAlert(err.message); });
        });
      });

      div.querySelectorAll('.btn-desv-disp').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var did = this.dataset.did;
          AL.confirmar({
            titulo: 'Desvincular Dispositivo',
            mensagem: 'Deseja desvincular este dispositivo deste cliente?',
            consequencias: 'O dispositivo ficará sem vínculo com este cliente mas não será excluído.',
            btnTexto: '<i class="fa fa-chain-broken"></i> Desvincular',
          }).then(function(ok) {
            if (!ok) return;
            AL.apiDelete('/api/dispositivos/' + did + '/clientes/' + clienteId)
              .then(function() { renderDispositivos(); })
              .catch(function(err) { AL.showAlert(err.message); });
          });
        });
      });

      if (canDeleteDispositivo) {
        div.querySelectorAll('.btn-del-disp').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var did = this.dataset.did;
            AL.confirmar({
              titulo: 'Excluir Dispositivo',
              mensagem: 'Deseja excluir este dispositivo?',
              consequencias: 'O dispositivo será removido permanentemente.',
              btnTexto: '<i class="fa fa-trash"></i> Excluir',
            }).then(function(ok) {
              if (!ok) return;
              AL.apiDelete('/api/dispositivos/' + did)
                .then(function() { renderDispositivos(); })
                .catch(function(err) { AL.showAlert(err.message); });
            });
          });
        });
      }
    })
    .catch(function(err) {
      document.getElementById('tab-dispositivos').innerHTML =
        '<div class="text-danger" style="padding:24px;">' + err.message + '</div>';
    });
}
```

- [ ] Mudar chamadas `renderDispositivos(c)` para `renderDispositivos()` sem parâmetro.

- [ ] Commit:
```bash
git add AgillockSite/colaborador/cliente-detalhe.html
git commit -m "feat: colaborador/cliente-detalhe — aba dispositivos mostra todos com vincular/desvincular"
```

---

## Task 9: Frontend — dispositivos.html (admin + colaborador) coluna Cliente

**Files:**
- Modify: `AgillockSite/admin/dispositivos.html`
- Modify: `AgillockSite/colaborador/dispositivos.html`

- [ ] Na função de render da tabela, na coluna "Cliente", usar `d._count.clientesVinculados` para o badge:

Padrão atual: `d.cliente ? d.cliente.nome : '—'`

Novo padrão:
```javascript
var clienteCol = d.cliente ? esc(d.cliente.nome) : '<span class="text-muted">—</span>';
if (d._count && d._count.clientesVinculados > 0) {
  clienteCol += ' <span class="al-badge badge-pendente" style="font-size:10px;padding:2px 6px;">+' + d._count.clientesVinculados + '</span>';
}
```

- [ ] Commit:
```bash
git add AgillockSite/admin/dispositivos.html AgillockSite/colaborador/dispositivos.html
git commit -m "feat: dispositivos.html — coluna cliente mostra responsável + badge de extras vinculados"
```
