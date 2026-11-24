/*******************************************************************
 *  CADASTRO DE AJUDA ÀS FAMÍLIAS ATINGIDAS PELAS CHUVAS
 *  Google Apps Script — cole este arquivo como "Code.gs"
 *******************************************************************/

/* ===================== CONFIGURAÇÃO ===================== */
/* Altere só o que está entre aspas.                          */
const CONFIG = {
  NOME_CAMPANHA: 'Ajuda às famílias atingidas pelas chuvas',
  EVENTO: 'pelas chuvas',  // completa a frase "famílias atingidas ...", ex.: 'pelo rompimento da barragem'

  // ABRANGÊNCIA — quem pode se cadastrar:
  //   uma cidade:     CIDADE: 'Petrópolis', UF: 'RJ'
  //   um estado:      CIDADE: '',           UF: 'RS'
  //   o país inteiro: CIDADE: '',           UF: ''
  CIDADE: '',
  UF: '',
  // A senha da área de entregas NÃO fica no código: defina em
  // Configurações do projeto > Propriedades do script > SENHA_ENTREGAS
  SENHA_ENTREGAS: PropertiesService.getScriptProperties().getProperty('SENHA_ENTREGAS') || '',
  CONTATO: ''              // ex.: 'Dúvidas: (24) 99999-9999 · Defesa Civil: 199'
};
/* ======================================================== */

const ABA = 'Cadastros';
const COLUNAS = [
  'Protocolo', 'Data', 'Nome', 'Telefone', 'CEP', 'Rua', 'Número', 'Complemento',
  'Bairro', 'Cidade', 'UF', 'Referência', 'Pessoas na casa', 'Prioridade',
  'Categorias', 'Higiene', 'Roupas', 'Alimentos', 'Itens de casa',
  'Latitude', 'Longitude', 'Localização', 'Status', 'Atualizado em', 'Obs. entrega'
];
const STATUS = ['Pendente', 'Em rota', 'Entregue', 'Cancelado'];
const MAX_PARADAS_VIAGEM = 23; // limite do Google para otimizar uma rota

/* ------------------ Página ------------------ */
function doGet(e) {
  const pagina = (e && e.parameter && e.parameter.pagina === 'entregas') ? 'entregas' : 'cadastro';
  const t = HtmlService.createTemplateFromFile('Index');
  t.pagina = pagina;
  t.config = seguroJs_(JSON.stringify({
    nome: CONFIG.NOME_CAMPANHA,
    evento: CONFIG.EVENTO,
    area: nomeArea_(),
    cidade: CONFIG.CIDADE,
    uf: CONFIG.UF,
    contato: CONFIG.CONTATO,
    url: ScriptApp.getService().getUrl()
  }));
  return t.evaluate()
    .setTitle(CONFIG.NOME_CAMPANHA)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Rode esta função uma vez pelo editor para criar a aba e autorizar o script. */
function configurar() {
  aba_();
  Maps.newGeocoder().setRegion('br').geocode('Brasília, DF');
  UrlFetchApp.fetch('https://viacep.com.br/ws/01001000/json/');
  if (!CONFIG.SENHA_ENTREGAS) {
    Logger.log('ATENÇÃO: defina SENHA_ENTREGAS em Configurações do projeto > Propriedades do script.');
  }
  Logger.log('Tudo certo! Agora publique em Implantar > Nova implantação > App da Web.');
}

/* ------------------ CEP ------------------ */
function buscarCep(cep) {
  cep = String(cep || '').replace(/\D/g, '');
  if (cep.length !== 8) return { ok: false, erro: 'O CEP precisa ter 8 números.' };
  const cache = CacheService.getScriptCache();
  let txt = cache.get('cep' + cep);
  if (!txt) {
    try {
      const r = UrlFetchApp.fetch('https://viacep.com.br/ws/' + cep + '/json/', { muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) {
        return { ok: false, manual: true, erro: 'Não conseguimos consultar o CEP agora. Preencha o endereço normalmente.' };
      }
      txt = r.getContentText();
      cache.put('cep' + cep, txt, 21600);
    } catch (err) {
      return { ok: false, manual: true, erro: 'Não conseguimos consultar o CEP agora. Preencha o endereço normalmente.' };
    }
  }
  const d = JSON.parse(txt);
  if (d.erro) return { ok: false, erro: 'CEP não encontrado. Confira os números.' };
  const fora = !dentroDaArea_(d.localidade, d.uf);
  return { ok: true, rua: d.logradouro || '', bairro: d.bairro || '', cidade: d.localidade, uf: d.uf, fora: fora };
}

/* ------------------ Cadastro (público) ------------------ */
function salvarCadastro(d) {
  d = d || {};
  const t = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);
  const c = {
    nome: t(d.nome, 120),
    telefone: t(d.telefone, 20),
    cep: t(d.cep, 9).replace(/\D/g, ''),
    rua: t(d.rua, 150),
    numero: t(d.numero, 20),
    complemento: t(d.complemento, 100),
    bairro: t(d.bairro, 100),
    cidade: t(d.cidade, 100),
    referencia: t(d.referencia, 200),
    pessoas: t(d.pessoas, 3).replace(/\D/g, ''),
    prioridade: (Array.isArray(d.prioridade) ? d.prioridade : []).map(x => t(x, 40)).slice(0, 6),
    higiene: t(d.higiene, 1000),
    roupas: t(d.roupas, 1000),
    alimentos: t(d.alimentos, 1000),
    casa: t(d.casa, 1000)
  };

  // Validações
  if (c.nome.length < 3) return { ok: false, erro: 'Informe o nome completo.' };
  const fone = c.telefone.replace(/\D/g, '');
  if (fone.length < 10 || fone.length > 11) return { ok: false, erro: 'Informe um telefone com DDD.' };
  if (c.cep.length !== 8) return { ok: false, erro: 'Informe um CEP válido.' };
  if (!c.rua || !c.numero || !c.bairro) return { ok: false, erro: 'Preencha rua, número e bairro.' };
  if (!d.consentimento) return { ok: false, erro: 'É preciso autorizar o uso dos dados para a entrega.' };
  const cats = [];
  if (c.higiene) cats.push('Higiene');
  if (c.roupas) cats.push('Roupas');
  if (c.alimentos) cats.push('Alimentos');
  if (c.casa) cats.push('Itens de casa');
  if (!cats.length) return { ok: false, erro: 'Escolha pelo menos uma categoria e descreva o que precisa.' };

  // Cidade
  let cidade = CONFIG.CIDADE, uf = CONFIG.UF;
  const infoCep = buscarCep(c.cep);
  if (infoCep.ok) {
    if (infoCep.fora) return { ok: false, erro: 'Este CEP é de ' + infoCep.cidade + ' - ' + infoCep.uf + '. O cadastro é só para moradores ' + nomeArea_() + '.' };
    cidade = infoCep.cidade; uf = infoCep.uf;
  } else if (!infoCep.manual) {
    return { ok: false, erro: infoCep.erro };
  } else if (!CONFIG.CIDADE) {
    // ViaCEP fora do ar e abrangência maior que uma cidade: usa a cidade digitada
    if (!c.cidade) return { ok: false, erro: 'Informe a cidade.' };
    cidade = c.cidade;
  }

  // Localização no mapa (para as rotas)
  const geo = geocodificar_(c.rua, c.numero, c.bairro, cidade, uf, c.cep);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = aba_();
    const protocolo = String(sh.getLastRow()).padStart(4, '0');

    // Aviso de possível cadastro repetido (mesmo telefone)
    let obs = '';
    if (sh.getLastRow() > 1) {
      const fones = sh.getRange(2, 4, sh.getLastRow() - 1, 1).getValues();
      const prots = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
      for (let i = 0; i < fones.length; i++) {
        if (String(fones[i][0]).replace(/\D/g, '') === fone) {
          obs = 'Possível cadastro repetido (mesmo telefone do protocolo ' + prots[i][0] + ')';
          break;
        }
      }
    }

    const linha = [
      protocolo, new Date(), c.nome, formatarFone_(fone), c.cep.replace(/(\d{5})(\d{3})/, '$1-$2'),
      c.rua, c.numero, c.complemento, c.bairro, cidade, uf, c.referencia, c.pessoas,
      c.prioridade.join(', '), cats.join(', '), c.higiene, c.roupas, c.alimentos, c.casa,
      geo ? geo.lat : '', geo ? geo.lng : '', geo ? geo.precisao : 'Não localizado',
      'Pendente', new Date(), obs
    ].map(semFormula_);
    sh.appendRow(linha);
    sh.getRange(sh.getLastRow(), 1).setNumberFormat('@').setValue(protocolo);
    return { ok: true, protocolo: protocolo };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------ Área de entregas (com senha) ------------------ */
function entrar(senha) {
  checarSenha_(senha);
  return { ok: true };
}

function listarCadastros(senha) {
  checarSenha_(senha);
  const sh = aba_();
  if (sh.getLastRow() < 2) return [];
  const valores = sh.getRange(2, 1, sh.getLastRow() - 1, COLUNAS.length).getValues();
  const tz = Session.getScriptTimeZone();
  return valores.filter(l => l[0] !== '').map(l => {
    const o = {};
    COLUNAS.forEach((col, i) => {
      let v = l[i];
      if (v instanceof Date) v = Utilities.formatDate(v, tz, 'dd/MM/yyyy HH:mm');
      o[chave_(col)] = v;
    });
    o.protocolo = String(o.protocolo);
    o.lat = o.latitude === '' ? null : Number(o.latitude);
    o.lng = o.longitude === '' ? null : Number(o.longitude);
    return o;
  });
}

function marcarStatus(senha, protocolos, status, obs) {
  checarSenha_(senha);
  if (STATUS.indexOf(status) < 0) throw new Error('Status inválido.');
  const lista = (protocolos || []).map(String);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = aba_();
    if (sh.getLastRow() < 2) return { ok: true, alterados: 0 };
    const prots = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    const colStatus = COLUNAS.indexOf('Status') + 1;
    const colObs = COLUNAS.indexOf('Obs. entrega') + 1;
    let n = 0;
    prots.forEach((p, i) => {
      if (lista.indexOf(String(p[0])) >= 0) {
        sh.getRange(i + 2, colStatus, 1, 2).setValues([[status, new Date()]]);
        if (obs) sh.getRange(i + 2, colObs).setValue(semFormula_(String(obs).slice(0, 300)));
        n++;
      }
    });
    return { ok: true, alterados: n };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Calcula as rotas de entrega.
 * opts: { origem: 'endereço ou lat,lng', protocolos: [...], porViagem: 10, voltar: true }
 */
function calcularRotas(senha, opts) {
  checarSenha_(senha);
  opts = opts || {};
  const porViagem = Math.max(1, Math.min(MAX_PARADAS_VIAGEM, parseInt(opts.porViagem, 10) || 10));
  const voltar = opts.voltar !== false;

  // Ponto de partida
  const origemTxt = String(opts.origem || '').trim();
  if (!origemTxt) throw new Error('Informe o ponto de partida.');
  let origem = null;
  const m = origemTxt.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    origem = { lat: Number(m[1]), lng: Number(m[2]), endereco: origemTxt };
  } else {
    let comCidade = origemTxt;
    if (CONFIG.CIDADE && normalizar_(origemTxt).indexOf(normalizar_(CONFIG.CIDADE)) < 0) {
      comCidade += ', ' + CONFIG.CIDADE + (CONFIG.UF ? ' - ' + CONFIG.UF : '');
    } else if (!CONFIG.CIDADE && CONFIG.UF) {
      comCidade += ', ' + CONFIG.UF;
    }
    const g = geocode_(comCidade + ', Brasil');
    if (!g) throw new Error(CONFIG.CIDADE
      ? 'Não encontramos o ponto de partida no mapa. Tente escrever rua, número e bairro.'
      : 'Não encontramos o ponto de partida no mapa. Escreva rua, número, bairro e cidade.');
    origem = { lat: g.lat, lng: g.lng, endereco: g.endereco || origemTxt };
  }

  // Paradas escolhidas
  const escolhidos = (opts.protocolos || []).map(String);
  const todos = listarCadastros(senha).filter(r => escolhidos.indexOf(r.protocolo) >= 0);
  const semLocalizacao = todos.filter(r => r.lat == null || isNaN(r.lat));
  let pontos = todos.filter(r => r.lat != null && !isNaN(r.lat));
  if (!pontos.length) return { origem: origem, viagens: [], semLocalizacao: semLocalizacao };

  // 1) Ordem pelo vizinho mais próximo, saindo do ponto de partida
  const ordem = [];
  let atual = origem;
  while (pontos.length) {
    let melhor = 0, dMin = Infinity;
    pontos.forEach((p, i) => {
      const dd = distKm_(atual, p);
      if (dd < dMin) { dMin = dd; melhor = i; }
    });
    atual = pontos.splice(melhor, 1)[0];
    ordem.push(atual);
  }

  // 2) Divide em viagens e 3) otimiza cada viagem pelas ruas (Google)
  const viagens = [];
  for (let i = 0; i < ordem.length; i += porViagem) {
    viagens.push(otimizarViagem_(origem, ordem.slice(i, i + porViagem), voltar, viagens.length + 1));
  }
  return { origem: origem, viagens: viagens, semLocalizacao: semLocalizacao };
}

function otimizarViagem_(origem, paradas, voltar, numero) {
  let seq = paradas.slice();
  let distM = 0, tempoS = 0, estimado = false;
  try {
    const df = Maps.newDirectionFinder()
      .setLanguage('pt-BR').setRegion('br')
      .setMode(Maps.DirectionFinder.Mode.DRIVING)
      .setOrigin(origem.lat, origem.lng);
    let fixoFinal = null, meio = seq;
    if (voltar) {
      df.setDestination(origem.lat, origem.lng);
    } else {
      // termina na parada mais distante do ponto de partida
      let iMax = 0;
      seq.forEach((p, i) => { if (distKm_(origem, p) > distKm_(origem, seq[iMax])) iMax = i; });
      fixoFinal = seq[iMax];
      meio = seq.filter((_, i) => i !== iMax);
      df.setDestination(fixoFinal.lat, fixoFinal.lng);
    }
    meio.forEach(p => df.addWaypoint(p.lat, p.lng));
    if (meio.length > 1) df.setOptimizeWaypoints(true);
    const res = df.getDirections();
    if (!res || res.status !== 'OK' || !res.routes || !res.routes.length) throw new Error(res && res.status);
    const rota = res.routes[0];
    const ordemWp = rota.waypoint_order || meio.map((_, i) => i);
    seq = ordemWp.map(i => meio[i]);
    if (fixoFinal) seq.push(fixoFinal);
    rota.legs.forEach(l => { distM += l.distance.value; tempoS += l.duration.value; });
  } catch (err) {
    // Sem resposta do Google: mantém a ordem por proximidade e estima
    estimado = true;
    let ant = origem, km = 0;
    seq.forEach(p => { km += distKm_(ant, p); ant = p; });
    if (voltar) km += distKm_(ant, origem);
    distM = km * 1.35 * 1000;      // ruas não são linha reta
    tempoS = (distM / 1000) / 25 * 3600; // ~25 km/h na cidade
  }
  return {
    numero: numero,
    paradas: seq,
    distanciaKm: Math.round(distM / 100) / 10,
    tempoMin: Math.round(tempoS / 60),
    estimado: estimado,
    links: linksMaps_(origem, seq, voltar)
  };
}

/** Google Maps aceita poucas paradas por link; divide em trechos de até 10 pontos. */
function linksMaps_(origem, seq, voltar) {
  const pts = [origem].concat(seq);
  if (voltar) pts.push(origem);
  const ll = p => p.lat.toFixed(6) + ',' + p.lng.toFixed(6);
  const links = [];
  const POR_LINK = 10;
  for (let i = 0; i < pts.length - 1; i += POR_LINK - 1) {
    const trecho = pts.slice(i, i + POR_LINK);
    if (trecho.length < 2) break;
    const o = trecho[0], d = trecho[trecho.length - 1], w = trecho.slice(1, -1);
    let url = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + ll(o) + '&destination=' + ll(d);
    if (w.length) url += '&waypoints=' + encodeURIComponent(w.map(ll).join('|'));
    links.push(url);
  }
  return links;
}

/* ------------------ Auxiliares ------------------ */
function aba_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ABA);
  if (!sh) sh = ss.insertSheet(ABA);
  if (sh.getLastRow() === 0) {
    sh.appendRow(COLUNAS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, COLUNAS.length).setFontWeight('bold').setBackground('#dbeafe');
    sh.getRange('A:A').setNumberFormat('@');
  }
  return sh;
}

function checarSenha_(senha) {
  if (!CONFIG.SENHA_ENTREGAS) {
    throw new Error('Senha ainda não configurada. Defina SENHA_ENTREGAS nas Propriedades do script.');
  }
  if (String(senha || '') !== String(CONFIG.SENHA_ENTREGAS)) {
    Utilities.sleep(800);
    throw new Error('Senha incorreta.');
  }
}

function geocodificar_(rua, numero, bairro, cidade, uf, cep) {
  const cepF = cep.replace(/(\d{5})(\d{3})/, '$1-$2');
  const local = [cidade, uf].filter(Boolean).join(' - ');
  const tentativas = [
    [rua + ', ' + numero, bairro, local, cepF, 'Brasil'].filter(Boolean).join(', '),
    [rua, bairro, local, 'Brasil'].filter(Boolean).join(', '),
    cepF + ', ' + local + ', Brasil'
  ];
  for (let i = 0; i < tentativas.length; i++) {
    const g = geocode_(tentativas[i]);
    if (g) {
      g.precisao = (i === 0 && g.exato) ? 'Exata' : 'Aproximada';
      return g;
    }
  }
  return null;
}

function geocode_(endereco) {
  try {
    const r = Maps.newGeocoder().setRegion('br').setLanguage('pt-BR').geocode(endereco);
    if (r.status === 'OK' && r.results && r.results.length) {
      const res = r.results[0];
      const tipo = res.geometry.location_type;
      return {
        lat: res.geometry.location.lat,
        lng: res.geometry.location.lng,
        endereco: res.formatted_address,
        exato: tipo === 'ROOFTOP' || tipo === 'RANGE_INTERPOLATED'
      };
    }
  } catch (e) { /* cota diária ou falha temporária */ }
  return null;
}

function distKm_(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function normalizar_(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
/** Verifica se a cidade/UF do CEP está dentro da abrangência configurada. */
function dentroDaArea_(cidade, uf) {
  if (CONFIG.UF && normalizar_(uf) !== normalizar_(CONFIG.UF)) return false;
  if (CONFIG.CIDADE && normalizar_(cidade) !== normalizar_(CONFIG.CIDADE)) return false;
  return true;
}
/** Área atendida, para frases: "de Petrópolis - RJ", "do estado RS" ou "". */
function nomeArea_() {
  if (CONFIG.CIDADE) return 'de ' + CONFIG.CIDADE + (CONFIG.UF ? ' - ' + CONFIG.UF : '');
  return CONFIG.UF ? 'do estado ' + CONFIG.UF : '';
}
function formatarFone_(f) {
  return f.length === 11 ? f.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
                         : f.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
}
/** Evita que um texto digitado vire fórmula na planilha. */
function semFormula_(v) {
  return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
}
function chave_(col) {
  return normalizar_(col).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
function seguroJs_(s) {
  return s.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028|\u2029/g, '');
}
