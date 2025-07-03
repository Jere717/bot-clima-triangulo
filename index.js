import * as cheerio from 'cheerio';
// Utilidad para evitar repetir noticias ya enviadas
function cargarNoticiasEnviadas() {
  try {
    return JSON.parse(fs.readFileSync('./noticias_enviadas.json', 'utf8'));
  } catch {
    return { enviadas: {} };
  }
}

function guardarNoticiasEnviadas(data) {
  fs.writeFileSync('./noticias_enviadas.json', JSON.stringify(data, null, 2));
}

// (Definición duplicada eliminada)
// Carga variables de entorno
import 'dotenv/config';
import fetch from 'node-fetch';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
// import cron from 'node-cron';
import { Groq } from 'groq-sdk';
import fs from 'fs';

const groq = new Groq(process.env.GROQ_API_KEY);
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './sessions' }),
  puppeteer: {
    executablePath: '/data/data/com.termux/files/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ],
    headless: true,
    defaultViewport: null,
  }
});

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
  console.log('Escanea este QR para vincular el bot de clima.');
});
import Parser from 'rss-parser';

// Extrae noticias útiles de RSS para cada localidad
async function getNoticiasUtiles() {
  const parser = new Parser();
  // Solo fuentes confiables y activas, priorizando EQS Notas
  const fuentes = [
    { url: 'https://www.eqsnotas.com/rss', localidad: ['El Hoyo', 'Comarca', 'Lago Puelo', 'El Bolsón', 'Chubut', 'Río Negro'], tipo: 'rss' },
    { url: 'https://www.infochucao.com/category/provinciales/', localidad: ['Chubut', 'Comarca', 'Lago Puelo', 'El Bolsón', 'El Hoyo'], tipo: 'scraping' },
    { url: 'https://www.infochucao.com/category/regionales/', localidad: ['Comarca', 'Lago Puelo', 'El Bolsón', 'El Hoyo'], tipo: 'scraping' },
    { url: 'https://www.infochucao.com/category/el-hoyo/', localidad: ['El Hoyo'], tipo: 'scraping' },
    { url: 'https://www.infochucao.com/category/lago-puelo/', localidad: ['Lago Puelo'], tipo: 'scraping' },
    { url: 'https://www.infochucao.com/category/el-bolson/', localidad: ['El Bolsón'], tipo: 'scraping' }
  ];
  let noticias = [];
  for (const fuente of fuentes) {
    try {
      if (fuente.tipo === 'scraping') {
        // Scraping InfoChucao
        const html = await fetch(fuente.url).then(r => r.text());
        const $ = cheerio.load(html);
        $('.jeg_postblock_content').each((i, el) => {
          const titulo = $(el).find('.jeg_post_title a').text().trim();
          const link = $(el).find('.jeg_post_title a').attr('href');
          const resumen = $(el).find('.jeg_post_excerpt').text().trim();
          if (titulo && link && !noticias.some(n => n.link === link)) {
            noticias.push({
              titulo,
              resumen,
              link,
              localidad: fuente.localidad.join(', ')
            });
          }
        });
      } else {
        const feed = await parser.parseURL(fuente.url);
        for (const item of feed.items) {
          // Filtro básico de utilidad y descarte de temas no deseados
          const texto = (item.title + ' ' + (item.contentSnippet || '')).toLowerCase();
          if (/violaci[oó]n|asesinat|homicid|pol[ií]tic|elecci[oó]n|partido/i.test(texto)) continue;
          if (/corte|servicio|ruta|gas|animal|alimento|tienda|descuento|consejo|colectivo|horario|agua|luz|electricidad|transporte|evento|actividad|vecino|municipio|escuela|salud|hospital|vacuna|clase|alerta|emergencia|seguridad|incendio|fuego|fr[ií]o|calor|nieve|lluvia|viento|temporal|granizo|nev|sismo|terremoto|recomendaci[oó]n|prevenci[oó]n|trabajo|empleo|barrio|zona|barrial|comunitari|solidaridad|donaci[oó]n|ayuda|beneficio|subsidio|tarifa|precio|mercado|feria|cultural|deporte|club|jard[ií]n|plaza|parque|limpieza|recolecci[oó]n|basura|residuos|reciclaje|poda|arbol|plant|mascota|perro|gato|extraviad|encontrad|busca|perd[ií]d|encontr[oó]|hallad|alerta|urgente/i.test(texto)) {
            // Evitar duplicados por link y verificar que el link funcione y que el contenido no sea "no encontrado"
            if (!noticias.some(n => n.link === item.link)) {
              try {
                const resp = await fetch(item.link, { method: 'GET', redirect: 'follow' });
                if (resp.ok) {
                  const pageText = await resp.text();
                  if (!/no encontrado|404|not found|no existe|página no encontrada|error/i.test(pageText)) {
                    noticias.push({
                      titulo: item.title,
                      resumen: item.contentSnippet || '',
                      link: item.link,
                      localidad: fuente.localidad.join(', ')
                    });
                  }
                }
              } catch (e) {
                // Si el link está roto, no lo agregues
              }
            }
          }
        }
      }
    } catch (e) {
      // Si falla una fuente, sigue con las demás
    }
  }
  // Registro de noticias enviadas
  let registro;
  try {
    registro = JSON.parse(fs.readFileSync('./noticias_enviadas.json', 'utf8'));
  } catch {
    registro = { enviadas: {} };
  }
  const hoy = new Date().toISOString().slice(0, 10);
  if (!registro.enviadas[hoy]) registro.enviadas[hoy] = [];

  // Elegir una noticia útil para cada localidad principal y registrar
  const resultado = {};
  ['Lago Puelo', 'El Hoyo', 'El Bolsón'].forEach(loc => {
    let noticia = noticias.find(n =>
      (n.titulo.toLowerCase().includes(loc.toLowerCase()) || n.resumen.toLowerCase().includes(loc.toLowerCase()) || n.localidad.toLowerCase().includes(loc.toLowerCase())) &&
      !registro.enviadas[hoy].includes(n.link)
    );
    // Si no hay nueva, buscar alguna útil antigua no enviada hoy
    if (!noticia) {
      noticia = noticias.find(n =>
        (n.titulo.toLowerCase().includes(loc.toLowerCase()) || n.resumen.toLowerCase().includes(loc.toLowerCase()) || n.localidad.toLowerCase().includes(loc.toLowerCase())) &&
        !Object.values(registro.enviadas).flat().includes(n.link)
      );
    }
    // Si no hay, permitir repetir alguna útil (recordatorio)
    if (!noticia) {
      noticia = noticias.find(n =>
        n.titulo.toLowerCase().includes(loc.toLowerCase()) || n.resumen.toLowerCase().includes(loc.toLowerCase()) || n.localidad.toLowerCase().includes(loc.toLowerCase())
      );
    }
    resultado[loc] = noticia;
    // Limpieza: si algún campo del prompt quedó sin reemplazar, lo borra del mensaje final
    if (noticia) {
      noticia.titulo = noticia.titulo.replace(/\[.*?\]|\{\{.*?\}\}/g, '').trim();
      noticia.resumen = noticia.resumen.replace(/\[.*?\]|\{\{.*?\}\}/g, '').trim();
      // Registrar como enviada hoy si existe y no está ya
      if (!registro.enviadas[hoy].includes(noticia.link)) {
        registro.enviadas[hoy].push(noticia.link);
      }
    }
  });
  fs.writeFileSync('./noticias_enviadas.json', JSON.stringify(registro, null, 2));
  return resultado;
}

// Coordenadas de las localidades
const COORDS = {
  'Lago Puelo': { lat: -42.1086, lon: -71.6266 },
  'El Hoyo': { lat: -42.0686, lon: -71.5333 },
  'El Bolsón': { lat: -41.9645, lon: -71.5333 }
};

// Clima actual para informe diario
async function getClimaActual(localidad) {
  const { lat, lon } = COORDS[localidad];
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=America%2FArgentina%2FBuenos_Aires`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    const w = data.current_weather;
    if (!w || typeof w.weathercode === 'undefined') {
      console.warn(`No se pudo obtener clima para ${localidad}. Respuesta:`, data);
      return {
        temp: 'N/D',
        clima: 'No disponible',
        viento: '-'
      };
    }
    const weatherDesc = weatherCodeToDesc(w.weathercode);
    return {
      temp: w.temperature,
      clima: weatherDesc,
      viento: w.windspeed
    };
  } catch (error) {
    console.error(`Error al obtener clima para ${localidad}:`, error);
    return {
      temp: 'N/D',
      clima: 'No disponible',
      viento: '-'
    };
  }
}

// Pronóstico semanal para informe semanal
async function getClimaSemanal(localidad) {
  const { lat, lon } = COORDS[localidad];
  // daily=temperature_2m_max,temperature_2m_min,weathercode
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weathercode&forecast_days=7&timezone=America%2FArgentina%2FBuenos_Aires`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (!data.daily) {
      console.warn(`No se pudo obtener pronóstico semanal para ${localidad}. Respuesta:`, data);
      return {
        min: 'N/D',
        max: 'N/D',
        tendencia: 'No disponible'
      };
    }
    const min = Math.min(...data.daily.temperature_2m_min);
    const max = Math.max(...data.daily.temperature_2m_max);
    // Tendencia: mayor weathercode de la semana
    const weatherCodes = data.daily.weathercode;
    const tendencia = weatherCodeToDesc(mostFrequent(weatherCodes));
    return {
      min,
      max,
      tendencia
    };
  } catch (error) {
    console.error(`Error al obtener pronóstico semanal para ${localidad}:`, error);
    return {
      min: 'N/D',
      max: 'N/D',
      tendencia: 'No disponible'
    };
  }
}

function mostFrequent(arr) {
  return arr.sort((a,b) => arr.filter(v => v===a).length - arr.filter(v => v===b).length).pop();
}

function weatherCodeToDesc(code) {
  // Basado en https://open-meteo.com/en/docs#api_form
  const map = {
    0: 'Despejado',
    1: 'Principalmente despejado',
    2: 'Parcialmente nublado',
    3: 'Nublado',
    45: 'Niebla',
    48: 'Niebla con escarcha',
    51: 'Llovizna ligera',
    53: 'Llovizna moderada',
    55: 'Llovizna densa',
    56: 'Llovizna helada ligera',
    57: 'Llovizna helada densa',
    61: 'Lluvia ligera',
    63: 'Lluvia moderada',
    65: 'Lluvia intensa',
    66: 'Lluvia helada ligera',
    67: 'Lluvia helada intensa',
    71: 'Nieve ligera',
    73: 'Nieve moderada',
    75: 'Nieve intensa',
    77: 'Granos de nieve',
    80: 'Chubascos ligeros',
    81: 'Chubascos moderados',
    82: 'Chubascos violentos',
    85: 'Chubascos de nieve ligeros',
    86: 'Chubascos de nieve intensos',
    95: 'Tormenta',
    96: 'Tormenta con granizo leve',
    99: 'Tormenta con granizo fuerte'
  };
  return map[code] || 'Desconocido';
}

async function generarMensajeClima(datosPuelo, datosHoyo, datosBolson, tipo) {
  // Selecciona el prompt según el tipo
  let promptFile = './prompt_diario.txt';
  let prompt = '';
  if (tipo === 'semanal') {
    promptFile = './prompt_semanal.txt';
    const promptBase = fs.readFileSync(promptFile, 'utf8');
    // Calcular fechas de inicio y fin (formato dd/mm/yyyy)
    const hoy = new Date();
    const fecha_inicio = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth()+1).padStart(2, '0')}/${hoy.getFullYear()}`;
    const fin = new Date(hoy);
    fin.setDate(hoy.getDate() + 6);
    const fecha_fin = `${String(fin.getDate()).padStart(2, '0')}/${String(fin.getMonth()+1).padStart(2, '0')}/${fin.getFullYear()}`;
    prompt = promptBase
      .replace(/\{\{fecha_inicio\}\}/g, fecha_inicio)
      .replace(/\{\{fecha_fin\}\}/g, fecha_fin)
      .replace(/\{\{puelo\.min\}\}/g, datosPuelo.min)
      .replace(/\{\{puelo\.max\}\}/g, datosPuelo.max)
      .replace(/\{\{puelo\.tendencia\}\}/g, datosPuelo.tendencia)
      .replace(/\{\{hoyo\.min\}\}/g, datosHoyo.min)
      .replace(/\{\{hoyo\.max\}\}/g, datosHoyo.max)
      .replace(/\{\{hoyo\.tendencia\}\}/g, datosHoyo.tendencia)
      .replace(/\{\{bolson\.min\}\}/g, datosBolson.min)
      .replace(/\{\{bolson\.max\}\}/g, datosBolson.max)
      .replace(/\{\{bolson\.tendencia\}\}/g, datosBolson.tendencia);
  } else {
    const promptBase = fs.readFileSync(promptFile, 'utf8');
    // Siempre usar la fecha local del sistema para el diario
    const hoy = new Date();
    const fecha_hoy = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth()+1).padStart(2, '0')}/${hoy.getFullYear()}`;
    prompt = promptBase
      .replace(/\{\{fecha_hoy\}\}/g, fecha_hoy)
      .replace(/\{\{puelo\.temp\}\}/g, datosPuelo.temp)
      .replace(/\{\{puelo\.clima\}\}/g, datosPuelo.clima)
      .replace(/\{\{puelo\.viento\}\}/g, datosPuelo.viento)
      .replace(/\{\{hoyo\.temp\}\}/g, datosHoyo.temp)
      .replace(/\{\{hoyo\.clima\}\}/g, datosHoyo.clima)
      .replace(/\{\{hoyo\.viento\}\}/g, datosHoyo.viento)
      .replace(/\{\{bolson\.temp\}\}/g, datosBolson.temp)
      .replace(/\{\{bolson\.clima\}\}/g, datosBolson.clima)
      .replace(/\{\{bolson\.viento\}\}/g, datosBolson.viento);
  }
  const response = await groq.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: "llama3-70b-8192", // Modelo recomendado por Groq (junio 2025)
  });
  return response.choices[0].message.content;
}

import readline from 'readline';

client.on('ready', async () => {
  console.log('Bot listo y conectado a WhatsApp!');

  // Reintentar mostrar grupos con menos de 4 integrantes hasta encontrarlos o agotar tiempo
  // const maxTries = 20; // 20 segundos máximo
  // let tries = 0;
  // let gruposMostrados = false;
  // const mostrarGrupos = async () => {
  //   tries++;
  //   try {
  //     const chats = await client.getChats();
  //     const gruposPequenos = chats.filter(
  //       c => c.isGroup && c.participants && c.participants.length < 4
  //     );
  //     if (gruposPequenos.length > 0) {
  //       console.log('Grupos con menos de 4 integrantes:');
  //       gruposPequenos.forEach(g => {
  //         console.log(`- ${g.name} (ID: ${g.id._serialized}) - Integrantes: ${g.participants.length}`);
  //       });
  //       gruposMostrados = true;
  //       mostrarMenu();
  //       return;
  //     } else if (tries >= maxTries) {
  //       console.log('No se encontraron grupos con menos de 4 integrantes tras varios intentos.');
  //       mostrarMenu();
  //       return;
  //     }
  //   } catch (e) {
  //     if (tries >= maxTries) {
  //       console.log('No se pudo obtener la lista de grupos tras varios intentos:', e);
  //       mostrarMenu();
  //       return;
  //     }
  //   }
  //   setTimeout(mostrarGrupos, 1000);
  // };
  mostrarMenu();
});

async function mostrarMenu() {
  const grupoId = process.env.GRUPO_ID;
  try {
    const chat = await client.getChatById(grupoId);
    const nombreGrupo = chat.name;
    const cantidad = chat.participants ? chat.participants.length : 'N/D';
    console.log(`\nDestino configurado: ${nombreGrupo} (ID: ${grupoId})`);
    console.log(`Integrantes: ${cantidad}`);
  } catch (e) {
    console.log(`\nNo se pudo obtener información del grupo (${grupoId}). Verifica el ID.`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n¿Qué deseas hacer?');
  console.log('1. Enviar informe diario (clima)');
  console.log('2. Enviar informe semanal (clima semanal)');
  console.log('3. Enviar mensaje de prueba');
  console.log('4. Salir');

  rl.question('Elige una opción (1-4): ', async (opcion) => {
    if (opcion === '1') {
      await enviarInforme('diario');
      rl.close();
      mostrarMenu();
    } else if (opcion === '2') {
      await enviarInforme('semanal');
      rl.close();
      mostrarMenu();
    } else if (opcion === '3') {
      await enviarMensajePrueba();
      rl.close();
      mostrarMenu();
    } else if (opcion === '4') {
      console.log('Saliendo...');
      rl.close();
      process.exit(0);
    } else {
      console.log('Opción no válida.');
      rl.close();
      mostrarMenu();
    }
  });
}
async function enviarMensajePrueba() {
  const grupoId = process.env.GRUPO_ID;
  try {
    const chat = await client.getChatById(grupoId);
    const nombreGrupo = chat.name;
    const cantidad = chat.participants ? chat.participants.length : 'N/D';
    console.log(`Enviando mensaje de prueba a: ${nombreGrupo} (${grupoId}) con ${cantidad} integrantes.`);
    await client.sendMessage(grupoId, '. (mensaje de prueba, ignorar)');
    console.log('Mensaje de prueba enviado.');
  } catch (e) {
    console.log('No se pudo enviar el mensaje de prueba. Verifica el ID del grupo.');
  }
}

async function enviarInforme(tipo) {
  const grupoId = process.env.GRUPO_ID;
  let mensaje = '';
  if (tipo === 'semanal') {
    // Solo reporte semanal (solo clima)
    const climaPuelo = await getClimaSemanal('Lago Puelo');
    const climaHoyo = await getClimaSemanal('El Hoyo');
    const climaBolson = await getClimaSemanal('El Bolsón');
    mensaje = await generarMensajeClima(climaPuelo, climaHoyo, climaBolson, 'semanal');
  } else if (tipo === 'diario') {
    // Solo reporte diario (solo clima)
    const climaPuelo = await getClimaActual('Lago Puelo');
    const climaHoyo = await getClimaActual('El Hoyo');
    const climaBolson = await getClimaActual('El Bolsón');
    mensaje = await generarMensajeClima(climaPuelo, climaHoyo, climaBolson, 'diario');
  } else if (tipo === 'lunes') {
    // Lunes especial: clima diario, semanal y noticias de cada localidad
    const climaPuelo = await getClimaActual('Lago Puelo');
    const climaHoyo = await getClimaActual('El Hoyo');
    const climaBolson = await getClimaActual('El Bolsón');
    const climaPueloSem = await getClimaSemanal('Lago Puelo');
    const climaHoyoSem = await getClimaSemanal('El Hoyo');
    const climaBolsonSem = await getClimaSemanal('El Bolsón');
    const noticias = await getNoticiasUtiles();
    let promptBase = fs.readFileSync('./prompt_lunes.txt', 'utf8');
    const hoy = new Date();
    const fecha_hoy = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth()+1).padStart(2, '0')}/${hoy.getFullYear()}`;
    const fin = new Date(hoy);
    fin.setDate(hoy.getDate() + 6);
    const fecha_inicio = fecha_hoy;
    const fecha_fin = `${String(fin.getDate()).padStart(2, '0')}/${String(fin.getMonth()+1).padStart(2, '0')}/${fin.getFullYear()}`;
    promptBase = promptBase
      .replace(/\{\{fecha_hoy\}\}/g, fecha_hoy)
      .replace(/\{\{fecha_inicio\}\}/g, fecha_inicio)
      .replace(/\{\{fecha_fin\}\}/g, fecha_fin)
      .replace(/\{\{puelo\.temp\}\}/g, climaPuelo.temp)
      .replace(/\{\{puelo\.clima\}\}/g, climaPuelo.clima)
      .replace(/\{\{puelo\.viento\}\}/g, climaPuelo.viento)
      .replace(/\{\{hoyo\.temp\}\}/g, climaHoyo.temp)
      .replace(/\{\{hoyo\.clima\}\}/g, climaHoyo.clima)
      .replace(/\{\{hoyo\.viento\}\}/g, climaHoyo.viento)
      .replace(/\{\{bolson\.temp\}\}/g, climaBolson.temp)
      .replace(/\{\{bolson\.clima\}\}/g, climaBolson.clima)
      .replace(/\{\{bolson\.viento\}\}/g, climaBolson.viento)
      .replace(/\{\{puelo\.min\}\}/g, climaPueloSem.min)
      .replace(/\{\{puelo\.max\}\}/g, climaPueloSem.max)
      .replace(/\{\{puelo\.tendencia\}\}/g, climaPueloSem.tendencia)
      .replace(/\{\{hoyo\.min\}\}/g, climaHoyoSem.min)
      .replace(/\{\{hoyo\.max\}\}/g, climaHoyoSem.max)
      .replace(/\{\{hoyo\.tendencia\}\}/g, climaHoyoSem.tendencia)
      .replace(/\{\{bolson\.min\}\}/g, climaBolsonSem.min)
      .replace(/\{\{bolson\.max\}\}/g, climaBolsonSem.max)
      .replace(/\{\{bolson\.tendencia\}\}/g, climaBolsonSem.tendencia)
      .replace(/\{\{noticia1\.titulo\}\}/g, noticias['Lago Puelo']?.titulo || 'Sin noticia')
      .replace(/\{\{noticia1\.resumen\}\}/g, noticias['Lago Puelo']?.resumen || '')
      .replace(/\{\{noticia1\.link\}\}/g, noticias['Lago Puelo']?.link || '')
      .replace(/\{\{noticia2\.titulo\}\}/g, noticias['El Hoyo']?.titulo || 'Sin noticia')
      .replace(/\{\{noticia2\.resumen\}\}/g, noticias['El Hoyo']?.resumen || '')
      .replace(/\{\{noticia2\.link\}\}/g, noticias['El Hoyo']?.link || '')
      .replace(/\{\{noticia3\.titulo\}\}/g, noticias['El Bolsón']?.titulo || 'Sin noticia')
      .replace(/\{\{noticia3\.resumen\}\}/g, noticias['El Bolsón']?.resumen || '')
      .replace(/\{\{noticia3\.link\}\}/g, noticias['El Bolsón']?.link || '');
    mensaje = (await groq.chat.completions.create({
      messages: [{ role: "user", content: promptBase }],
      model: "llama3-70b-8192",
    })).choices[0].message.content;
  } else if (tipo === 'noticias') {
    // Solo noticias y recomendación
    const noticias = await getNoticiasUtiles();
    const noticiasArr = Object.values(noticias).filter(Boolean).slice(0,2);
    let promptBase = fs.readFileSync('./prompt_noticias.txt', 'utf8');
    promptBase = promptBase
      .replace(/\{\{noticia1\.titulo\}\}/g, noticiasArr[0]?.titulo || 'Sin noticia')
      .replace(/\{\{noticia1\.resumen\}\}/g, noticiasArr[0]?.resumen || '')
      .replace(/\{\{noticia1\.link\}\}/g, noticiasArr[0]?.link || '')
      .replace(/\{\{noticia2\.titulo\}\}/g, noticiasArr[1]?.titulo || 'Sin noticia')
      .replace(/\{\{noticia2\.resumen\}\}/g, noticiasArr[1]?.resumen || '')
      .replace(/\{\{noticia2\.link\}\}/g, noticiasArr[1]?.link || '');
    mensaje = (await groq.chat.completions.create({
      messages: [{ role: "user", content: promptBase }],
      model: "llama3-70b-8192",
    })).choices[0].message.content;
  }
  await client.sendMessage(grupoId, mensaje);
  console.log('Informe enviado al grupo.');
}

// El bot solo envía mensajes automáticos, no responde a comandos del grupo.

client.initialize();
