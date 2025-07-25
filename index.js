import * as cheerio from 'cheerio';
import 'dotenv/config';
import fetch from 'node-fetch';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';
import { Groq } from 'groq-sdk';
import fs from 'fs';
import Parser from 'rss-parser';
import readline from 'readline';

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

// Leer configuración de .config para saber si se debe incluir executablePath
let configNoPath = false;
try {
  const configContent = fs.readFileSync('.config', 'utf8');
  const match = configContent.match(/noExecutablePath\s*=\s*(true|false)/i);
  if (match) {
    configNoPath = match[1].toLowerCase() === 'true';
  }
} catch {}

const groq = new Groq(process.env.GROQ_API_KEY);
let GENERAR_IMAGENES = false; // Cambiar a false para desactivar imágenes

const puppeteerConfig = {
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
};
if (!configNoPath) {
  puppeteerConfig.executablePath = '/data/data/com.termux/files/usr/bin/chromium-browser';
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './sessions' }),
  puppeteer: puppeteerConfig
});

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
  console.log('Escanea este QR para vincular el bot de clima.');
});

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
  // Agregar daily=temperature_2m_max,precipitation_sum y hourly=precipitation para obtener datos de lluvia
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,precipitation_sum&hourly=precipitation&timezone=America%2FArgentina%2FBuenos_Aires`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    const w = data.current_weather;
    // Lluvia total esperada hoy (mm)
    const lluviaTotal = data.daily?.precipitation_sum?.[0] ?? 0;
    // Lluvia por hora (mm)
    const horas = data.hourly?.time || [];
    const lluviaPorHora = data.hourly?.precipitation || [];

    // Determinar momentos de lluvia relevante
    let lluviaMomentos = [];
    for (let i = 0; i < horas.length; i++) {
      if (lluviaPorHora[i] >= 0.2) { // 0.2mm o más se considera lluvia perceptible
        const hora = parseInt(horas[i].slice(11, 13));
        if (hora >= 5 && hora < 12) lluviaMomentos.push('mañana');
        else if (hora >= 12 && hora < 17) lluviaMomentos.push('tarde');
        else if (hora >= 17 && hora < 20) lluviaMomentos.push('atardecer');
        else lluviaMomentos.push('noche');
      }
    }
    // Agrupar y hacer el mensaje más natural
    const bloques = [...new Set(lluviaMomentos)];
    let lluviaResumen = '';
    if (bloques.length === 1) {
      lluviaResumen = `por la ${bloques[0]}`;
    } else if (bloques.length === 2 && (
      (bloques.includes('noche') && bloques.includes('mañana')) ||
      (bloques.includes('mañana') && bloques.includes('tarde')) ||
      (bloques.includes('tarde') && bloques.includes('atardecer')) ||
      (bloques.includes('atardecer') && bloques.includes('noche'))
    )) {
      lluviaResumen = `entre la ${bloques[0]} y la ${bloques[1]}`;
    } else if (bloques.length > 0) {
      lluviaResumen = `en distintos momentos (${bloques.join(', ')})`;
    }

    // Clasificar intensidad
    let intensidad = 'nada';
    if (lluviaTotal >= 10) intensidad = 'lluvia intensa';
    else if (lluviaTotal >= 5) intensidad = 'lluvia moderada';
    else if (lluviaTotal >= 2) intensidad = 'lluvia ligera';
    else if (lluviaTotal >= 0.2) intensidad = 'llovizna';

    // Construir descripción de lluvia
    let lluviaDesc = 'nada';
    if (lluviaTotal >= 0.2) {
      lluviaDesc = `${intensidad} ${lluviaResumen} (${lluviaTotal.toFixed(1)} mm)`;
    }

    return {
      temp: w.temperature,
      max: data.daily.temperature_2m_max[0], // Máxima del día
      clima: weatherCodeToDesc(w.weathercode),
      viento: w.windspeed,
      lluvia: lluviaDesc
    };
  } catch (error) {
    console.error(`Error al obtener clima para ${localidad}:`, error);
    return {
      temp: 'N/D',
      max: 'N/D', // Máxima también "No disponible" en caso de error
      clima: 'No disponible',
      viento: '-',
      lluvia: 'No disponible'
    };
  }
}

// Pronóstico semanal para informe semanal
async function getClimaSemanal(localidad) {
  const { lat, lon } = COORDS[localidad];
  // daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_sum
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_sum&forecast_days=7&timezone=America%2FArgentina%2FBuenos_Aires`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (!data.daily) {
      console.warn(`No se pudo obtener pronóstico semanal para ${localidad}. Respuesta:`, data);
      return {
        min: 'N/D',
        max: 'N/D',
        tendencia: 'No disponible',
        dias: []
      };
    }
    const min = Math.min(...data.daily.temperature_2m_min);
    const max = Math.max(...data.daily.temperature_2m_max);
    // Tendencia: mayor weathercode de la semana
    const weatherCodes = data.daily.weathercode;
    const tendencia = weatherCodeToDesc(mostFrequent(weatherCodes));
    // Recolectar datos diarios relevantes
    const dias = data.daily.time.map((fecha, i) => ({
      fecha,
      weather: weatherCodeToDesc(data.daily.weathercode[i]),
      lluvia: data.daily.precipitation_sum[i]
    }));
    return {
      min,
      max,
      tendencia,
      dias
    };
  } catch (error) {
    console.error(`Error al obtener pronóstico semanal para ${localidad}:`, error);
    return {
      min: 'N/D',
      max: 'N/D',
      tendencia: 'No disponible',
      dias: []
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

// Nueva función para determinar la temporada en Argentina
function getTemporada() {
  const now = new Date();
  const month = now.getMonth() + 1; // Enero = 1, Diciembre = 12
  const day = now.getDate();

  // Hemisferio sur:
  if ((month === 12 && day >= 21) || month <= 2 || (month === 3 && day < 21)) {
    return 'verano';
  } else if (month >= 3 && month <= 5 || (month === 6 && day < 21)) {
    return 'otoño';
  } else if ((month === 6 && day >= 21) || month <= 8 || (month === 9 && day < 21)) {
    return 'invierno';
  } else {
    return 'primavera';
  }
}

// Función para determinar el momento del día
function getMomentoDia() {
  const hora = new Date().getHours();
  if (hora >= 5 && hora < 12) return 'mañana';
  if (hora >= 12 && hora < 17) return 'tarde';
  if (hora >= 17 && hora < 20) return 'atardecer';
  return 'noche';
}

// Función para generar imagen del clima
async function generarImagenClima(localidad, datosClima, tipo = 'diario') {
  try {
    // Detalles específicos por localidad
    const elementosCotidianos = {
      'Lago Puelo': 'ropa colgada, humo de estufas, barro en botas, lago de fondo',
      'El Hoyo': 'huertas, cerros, artesanías, gente en bicicleta',
      'El Bolsón': 'feria artesanal, montañas, jardines florecidos'
    };

    // Detalles según el clima
    const detallesClima = {
      'Despejado': 'cielo azul intenso, sombras marcadas, luz solar directa',
      'Principalmente despejado': 'algunas nubes dispersas, luz solar difusa',
      'Parcialmente nublado': 'mezcla de sol y nubes, claros ocasionales',
      'Nublado': 'cielo completamente cubierto, luz uniforme y difusa',
      'Lluvia ligera': 'charcos en el suelo, gotas en superficies, paraguas',
      'Lluvia moderada': 'lluvia visible, calles mojadas, gente con impermeables',
      'Lluvia intensa': 'torrentes de agua, techos goteando, visibilidad reducida',
      'Nieve ligera': 'copos cayendo, capa delgada en superficies',
      'Nieve intensa': 'acumulación notable, árboles nevados',
      'Niebla': 'visibilidad reducida, atmósfera misteriosa',
      'Tormenta': 'cielos oscuros, relámpagos en la distancia'
    };

    // Paletas de colores según clima y temporada
    const paletasTemporada = {
      verano: {
        'Despejado': 'tonos cálidos vibrantes, amarillos intensos',
        'Lluvia': 'grises con toques verdes frescos',
        'default': 'colores vivos y saturados'
      },
      otoño: {
        'Despejado': 'ocres, dorados, rojizos',
        'Lluvia': 'marrones terrosos, grises cálidos',
        'default': 'tonos tierra, rojizos, amarillos apagados'
      },
      invierno: {
        'Despejado': 'azules fríos, blancos brillantes',
        'Nieve': 'blancos puros, azules muy claros',
        'default': 'tonos fríos, azules y grises'
      },
      primavera: {
        'Despejado': 'pasteles brillantes, verdes frescos',
        'Lluvia': 'verdes intensos, grises azulados',
        'default': 'colores florecidos, tonos alegres'
      }
    };

    // Detalles específicos por temporada
    const detallesTemporada = {
      verano: 'flores silvestres, insectos, frutas maduras',
      otoño: 'hojas secas, ramas desnudas, cosechas',
      invierno: 'chimeneas humeantes, ropa abrigada',
      primavera: 'flores brotando, pájaros, renacer'
    };

    // Obtener temporada y momento del día
    const temporada = getTemporada();
    const momentoDia = getMomentoDia();
    const clima = tipo === 'semanal' ? datosClima.tendencia : datosClima.clima;

    // Seleccionar paleta de colores
    let paletaColores = paletasTemporada[temporada]['default'];
    if (paletasTemporada[temporada][clima]) {
      paletaColores = paletasTemporada[temporada][clima];
    } else {
      // Buscar coincidencia parcial (ej. "Lluvia ligera" coincide con "Lluvia")
      for (const key in paletasTemporada[temporada]) {
        if (clima.includes(key)) {
          paletaColores = paletasTemporada[temporada][key];
          break;
        }
      }
    }

    // Determinar detalles específicos
    let detallesEspecificos = detallesTemporada[temporada] + '. ';
    
    if (clima.includes('Lluvia')) {
      detallesEspecificos += 'Personas con paraguas o impermeables. ';
    }
    if (clima.includes('Nieve')) {
      detallesEspecificos += 'Huellas en la nieve, niños jugando. ';
    }
    if (clima.includes('Viento')) {
      detallesEspecificos += 'Árboles inclinados, hojas volando. ';
    }

    // Ajustes por momento del día
    const ajustesMomento = {
      mañana: 'luz matutina suave, rocío en las plantas',
      tarde: 'luz solar intensa, sombras definidas',
      atardecer: 'tonos anaranjados y rosados, sombras alargadas',
      noche: 'iluminación artificial cálida, luces en ventanas'
    };

    detallesEspecificos += ajustesMomento[momentoDia];

    // Seleccionar el archivo de prompt adecuado
    const promptFile = tipo === 'semanal' ? './prompt_semanal_img.txt' : './prompt_diario_img.txt';
    let prompt = fs.readFileSync(promptFile, 'utf8');

    // Reemplazar variables
    prompt = prompt
      .replace(/{{localidad}}/g, localidad)
      .replace(/{{elementos_cotidianos}}/g, elementosCotidianos[localidad] || 'escena cotidiana')
      .replace(/{{detalles_clima}}/g, detallesClima[clima] || '')
      .replace(/{{tendencia_clima}}/g, tipo === 'semanal' ? datosClima.tendencia : '')
      .replace(/{{descripcion_clima}}/g, tipo !== 'semanal' ? datosClima.clima : '')
      .replace(/{{paleta_colores}}/g, paletaColores)
      .replace(/{{detalles_especificos}}/g, detallesEspecificos)
      .replace(/{{enfoque_escena}}/g, tipo === 'semanal' ? 'panorámica que muestre el paso del tiempo' : 'momento cotidiano')
      .replace(/{{temporada}}/g, temporada)
      .replace(/{{momento_dia}}/g, momentoDia);

    console.log("Prompt mejorado con temporada y hora:", prompt);

    // Resto del código para generar la imagen...
    const response = await fetch(
      "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          inputs: prompt,
          parameters: {
            width: 1024,
            height: 768,
            num_inference_steps: 30,
            guidance_scale: 7.5
          }
        }),
      }
    );

    if (!response.ok) throw new Error(`Error en HuggingFace: ${response.status}`);

    const imageBuffer = await response.arrayBuffer();
    const tempImagePath = `./temp_${localidad.replace(/\s+/g, '_')}.png`;
    fs.writeFileSync(tempImagePath, Buffer.from(imageBuffer));

    return tempImagePath;
  } catch (error) {
    console.error('Error al generar imagen:', error);
    return null;
  }
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
    let inicio, fin;
    // Si hoy es domingo, mostrar lunes a viernes de la semana siguiente
    if (hoy.getDay() === 0) { // Domingo
      inicio = new Date(hoy);
      inicio.setDate(hoy.getDate() + 1); // Lunes
      fin = new Date(hoy);
      fin.setDate(hoy.getDate() + 5); // Viernes
    } else {
      inicio = new Date(hoy);
      fin = new Date(hoy);
      fin.setDate(hoy.getDate() + 6);
    }
    const fecha_inicio = `${String(inicio.getDate()).padStart(2, '0')}/${String(inicio.getMonth()+1).padStart(2, '0')}/${inicio.getFullYear()}`;
    const fecha_fin = `${String(fin.getDate()).padStart(2, '0')}/${String(fin.getMonth()+1).padStart(2, '0')}/${fin.getFullYear()}`;

    // --- Resumen de eventos relevantes y días con mayor probabilidad de lluvia ---
    // Analiza los días de los tres lugares y arma un resumen visual
    function formateaFecha(fechaISO) {
      const d = new Date(fechaISO);
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth()+1).padStart(2, '0')}`;
    }
    // Recolectar eventos por fecha/lugar/intensidad
    let eventosPorFecha = {};
    function agregaEvento(dias, nombre) {
      dias.forEach(d => {
        let intensidad = '';
        if (d.lluvia >= 5) intensidad = 'lluvia intensa';
        else if (d.lluvia >= 1) intensidad = 'lluvia ligera';
        else if (d.weather.toLowerCase().includes('tormenta')) intensidad = 'tormenta';
        else return;
        const fecha = formateaFecha(d.fecha);
        if (!eventosPorFecha[fecha]) eventosPorFecha[fecha] = {};
        if (!eventosPorFecha[fecha][intensidad]) eventosPorFecha[fecha][intensidad] = [];
        eventosPorFecha[fecha][intensidad].push(nombre);
      });
    }
    agregaEvento(datosPuelo.dias, 'Lago Puelo');
    agregaEvento(datosHoyo.dias, 'El Hoyo');
    agregaEvento(datosBolson.dias, 'El Bolsón');

    // Construir resumen agrupado, solo desde fecha_inicio hasta fecha_fin
    let resumen = '';
    const inicioDate = new Date(inicio);
    inicioDate.setHours(0,0,0,0);
    const finDate = new Date(fin);
    finDate.setHours(23,59,59,999);
    function parseFecha(fechaStr) {
      const [d, m] = fechaStr.split('/');
      return new Date(inicioDate.getFullYear(), parseInt(m)-1, parseInt(d));
    }
    const fechas = Object.keys(eventosPorFecha).sort().filter(fecha => {
      const f = parseFecha(fecha);
      return f >= inicioDate && f <= finDate;
    });
    if (fechas.length) {
      resumen = fechas.map(fecha => {
        const intensidades = Object.keys(eventosPorFecha[fecha]);
        return intensidades.map(intensidad => {
          const lugares = eventosPorFecha[fecha][intensidad].join(', ');
          return `${fecha}: ${intensidad} en ${lugares}`;
        }).join('. ');
      }).join('\n');
    } else {
      resumen = 'No se esperan lluvias ni eventos relevantes en estos días.';
    }

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
      .replace(/\{\{bolson\.tendencia\}\}/g, datosBolson.tendencia)
      .replace(/\{\{resumen_eventos\}\}/g, resumen);
  } else {
    const promptBase = fs.readFileSync(promptFile, 'utf8');
    // Siempre usar la fecha local del sistema para el diario
    const hoy = new Date();
    const fecha_hoy = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth()+1).padStart(2, '0')}/${hoy.getFullYear()}`;
    prompt = promptBase
      .replace(/\{\{fecha_hoy\}\}/g, fecha_hoy)
      .replace(/\{\{puelo\.temp\}\}/g, datosPuelo.temp)
      .replace(/\{\{puelo\.max\}\}/g, datosPuelo.max)
      .replace(/\{\{puelo\.clima\}\}/g, datosPuelo.clima)
      .replace(/\{\{puelo\.viento\}\}/g, datosPuelo.viento)
      .replace(/\{\{puelo\.lluvia\}\}/g, datosPuelo.lluvia)
      .replace(/\{\{hoyo\.temp\}\}/g, datosHoyo.temp)
      .replace(/\{\{hoyo\.max\}\}/g, datosHoyo.max)
      .replace(/\{\{hoyo\.clima\}\}/g, datosHoyo.clima)
      .replace(/\{\{hoyo\.viento\}\}/g, datosHoyo.viento)
      .replace(/\{\{hoyo\.lluvia\}\}/g, datosHoyo.lluvia)
      .replace(/\{\{bolson\.temp\}\}/g, datosBolson.temp)
      .replace(/\{\{bolson\.max\}\}/g, datosBolson.max)
      .replace(/\{\{bolson\.clima\}\}/g, datosBolson.clima)
      .replace(/\{\{bolson\.viento\}\}/g, datosBolson.viento)
      .replace(/\{\{bolson\.lluvia\}\}/g, datosBolson.lluvia);
  }
  const response = await groq.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: "llama3-70b-8192", // Modelo recomendado por Groq (junio 2025)
  });
  return response.choices[0].message.content;
}

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

  console.log(`\nConfiguración actual: Generación de imágenes ${GENERAR_IMAGENES ? 'ACTIVADA' : 'DESACTIVADA'}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n¿Qué deseas hacer?');
  console.log('1. Enviar informe diario (clima)');
  console.log('1a. Generar informe diario y aprobar antes de enviar');
  console.log('2. Enviar informe semanal (clima semanal)');
  console.log('2a. Generar informe semanal y aprobar antes de enviar');
  console.log('3. Enviar mensaje de prueba');
  console.log('4. Cambiar estado de generación de imágenes');
  console.log('5. Salir');

  rl.question('Elige una opción (1, 1a, 2, 2a, 3, 4, 5): ', async (opcion) => {
    if (opcion === '1' || opcion === '2') {
      // Envío directo y guardado
      const tipo = opcion === '1' ? 'diario' : 'semanal';
      const mensaje = await generarMensajeClima(
        tipo === 'semanal' ? await getClimaSemanal('Lago Puelo') : await getClimaActual('Lago Puelo'),
        tipo === 'semanal' ? await getClimaSemanal('El Hoyo') : await getClimaActual('El Hoyo'),
        tipo === 'semanal' ? await getClimaSemanal('El Bolsón') : await getClimaActual('El Bolsón'),
        tipo
      );
      fs.writeFileSync(`./reporte_${tipo}.txt`, mensaje);
      await enviarInforme(tipo);
      console.log(`Reporte ${tipo} enviado y guardado en ./reporte_${tipo}.txt`);
      rl.close();
      mostrarMenu();
    } else if (opcion === '1a' || opcion === '2a') {
      // Genera y espera aprobación
      const tipo = opcion === '1a' ? 'diario' : 'semanal';
      const mensaje = await generarMensajeClima(
        tipo === 'semanal' ? await getClimaSemanal('Lago Puelo') : await getClimaActual('Lago Puelo'),
        tipo === 'semanal' ? await getClimaSemanal('El Hoyo') : await getClimaActual('El Hoyo'),
        tipo === 'semanal' ? await getClimaSemanal('El Bolsón') : await getClimaActual('El Bolsón'),
        tipo
      );
      fs.writeFileSync(`./reporte_${tipo}.txt`, mensaje);
      console.log(`\n--- Vista previa del reporte (${tipo}) ---\n`);
      console.log(mensaje);
      rl.question('¿Enviar este reporte? (s/n): ', async (aprobacion) => {
        if (aprobacion.trim().toLowerCase() === 's') {
          await enviarInforme(tipo);
          console.log(`Reporte ${tipo} enviado y guardado en ./reporte_${tipo}.txt`);
        } else {
          console.log('Reporte NO enviado. Puedes revisar el archivo ./reporte_' + tipo + '.txt');
        }
        rl.close();
        mostrarMenu();
      });
    } else if (opcion === '3') {
      await enviarMensajePrueba();
      rl.close();
      mostrarMenu();
    } else if (opcion === '4') {
      GENERAR_IMAGENES = !GENERAR_IMAGENES;
      console.log(`Generación de imágenes ahora ${GENERAR_IMAGENES ? 'ACTIVADA' : 'DESACTIVADA'}`);
      rl.close();
      mostrarMenu();
    } else if (opcion === '5') {
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
  let imagenUrl = null;
  let mensajeEnviado = false;

  // Obtener datos del clima una sola vez
  const datos = {
    'Lago Puelo': tipo === 'semanal' ? await getClimaSemanal('Lago Puelo') : await getClimaActual('Lago Puelo'),
    'El Hoyo': tipo === 'semanal' ? await getClimaSemanal('El Hoyo') : await getClimaActual('El Hoyo'),
    'El Bolsón': tipo === 'semanal' ? await getClimaSemanal('El Bolsón') : await getClimaActual('El Bolsón')
  };

  // Manejar cada tipo de informe
  if (tipo === 'semanal' || tipo === 'diario') {
    mensaje = await generarMensajeClima(datos['Lago Puelo'], datos['El Hoyo'], datos['El Bolsón'], tipo);
    if (GENERAR_IMAGENES) {
      imagenUrl = await generarImagenClima('Lago Puelo', datos['Lago Puelo'], tipo);
    }
  }
  else if (tipo === 'lunes') {
    const noticias = await getNoticiasUtiles();
    const climaPueloSem = await getClimaSemanal('Lago Puelo');
    const climaHoyoSem = await getClimaSemanal('El Hoyo');
    const climaBolsonSem = await getClimaSemanal('El Bolsón');
    
    let promptBase = fs.readFileSync('./prompt_lunes.txt', 'utf8');
    const hoy = new Date();
    const fecha_hoy = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth()+1).padStart(2, '0')}/${hoy.getFullYear()}`;
    const fin = new Date(hoy);
    fin.setDate(hoy.getDate() + 6);
    const fecha_fin = `${String(fin.getDate()).padStart(2, '0')}/${String(fin.getMonth()+1).padStart(2, '0')}/${fin.getFullYear()}`;
    
    promptBase = promptBase
      .replace(/\{\{fecha_hoy\}\}/g, fecha_hoy)
      .replace(/\{\{fecha_inicio\}\}/g, fecha_hoy)
      .replace(/\{\{fecha_fin\}\}/g, fecha_fin)
      .replace(/\{\{puelo\.temp\}\}/g, datos['Lago Puelo'].temp)
      .replace(/\{\{puelo\.clima\}\}/g, datos['Lago Puelo'].clima)
      .replace(/\{\{puelo\.viento\}\}/g, datos['Lago Puelo'].viento)
      .replace(/\{\{hoyo\.temp\}\}/g, datos['El Hoyo'].temp)
      .replace(/\{\{hoyo\.clima\}\}/g, datos['El Hoyo'].clima)
      .replace(/\{\{hoyo\.viento\}\}/g, datos['El Hoyo'].viento)
      .replace(/\{\{bolson\.temp\}\}/g, datos['El Bolsón'].temp)
      .replace(/\{\{bolson\.clima\}\}/g, datos['El Bolsón'].clima)
      .replace(/\{\{bolson\.viento\}\}/g, datos['El Bolsón'].viento)
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
    
    imagenUrl = await generarImagenClima('Lago Puelo', datos['Lago Puelo'], 'lunes');
  } 
  else if (tipo === 'noticias') {
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

  // Enviar mensaje con/sin imagen
  if (imagenUrl && GENERAR_IMAGENES) {
    try {
      const media = MessageMedia.fromFilePath(imagenUrl);
      await client.sendMessage(grupoId, media, { caption: mensaje });
      fs.unlinkSync(imagenUrl);
      console.log('Informe con imagen enviado al grupo.');
      mensajeEnviado = true;
    } catch (error) {
      console.error('Error al enviar imagen:', error);
    }
  }

  // Enviar solo texto si falló la imagen o no hay imagen
  if (!mensajeEnviado) {
    await client.sendMessage(grupoId, mensaje);
    console.log('Informe enviado al grupo (sin imagen).');
  }

  // --- Cierre seguro ---
  if (process.argv.includes('--diario') || process.argv.includes('--semanal') || process.argv.includes('--noticias')) {
    setTimeout(() => {
      console.log('Cerrando proceso...');
      process.exit(0);
    }, 3000);
  }
}

// El bot solo envía mensajes automáticos, no responde a comandos del grupo.

if (import.meta.main) {
  const modo = process.argv[2];
  if (modo === 'diario' || modo === 'semanal' || modo === 'lunes' || modo === 'noticias') {
    enviarInforme(modo);
  } else {
    console.log('ℹ️ Usá: node index.js diario | semanal | lunes | noticias');
    process.exit(0);
  }
} else {
  client.initialize(); // Para cuando se ejecuta sin argumentos
}
