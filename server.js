// ============================
// UMAR MULTILINGUA BACKEND
// ============================

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

require('dotenv').config();

const app = express();

app.use(cors());

// A. Límite suficiente para recibir audio codificado en Base64.
app.use(express.json({ limit: '15mb' }));

// B. Rama configurable desde Render.
const owner = 'jfdelgado82';
const repo = 'UMARMultilingua';
const branch = process.env.GITHUB_BRANCH || 'main';

const BASE_URL = 'https://umarmultilingua.onrender.com';

const rutas = {
  diccionario: {
    1: 'zapoteco.json',
    2: 'chatino.json'
  },
  corpus: {
    1: 'CorpusZapoteco.json',
    2: 'CorpusChatino.json'
  },
  usuarios: {
    0: 'usuarios.json'
  }
};

const cacheData = {};
const cacheSHA = {};

const agrupaciones = {
  1: 'zapoteco',
  2: 'chatino'
};

const extensionesAudio = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav'
};

const tiposMime = {
  webm: 'audio/webm',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav'
};

const extensionesImagen = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

// ==========================================
// UTILIDADES GENERALES
// ==========================================

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function githubContentsUrl(path) {
  const encoded = path
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');

  return `https://api.github.com/repos/${owner}/${repo}/contents/${encoded}`;
}

function githubBlobUrl(sha) {
  return `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`;
}

function esConflictoGitHub(error) {
  const status = error.response?.status;
  return status === 409 || status === 422;
}

function validarTokenGitHub() {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error('Falta configurar GITHUB_TOKEN');
  }
}

// ==========================================
// LEER CONTENIDO DE GITHUB
// ==========================================

async function obtenerContenidoGitHub(response, path) {

  let contenidoBase64 = response.data.content;

  if (!contenidoBase64) {

    const sha = response.data.sha;

    if (!sha) {
      throw new Error(`GitHub no devolvió SHA para ${path}`);
    }

    const blob = await axios.get(githubBlobUrl(sha), {
      headers: githubHeaders()
    });

    if (
      !blob.data.content ||
      blob.data.encoding !== 'base64'
    ) {
      throw new Error(`No se pudo leer el contenido de ${path}`);
    }

    contenidoBase64 = blob.data.content;
  }

  const contenido = Buffer.from(
    contenidoBase64.replace(/\s/g, ''),
    'base64'
  ).toString('utf8');

  try {
    return JSON.parse(contenido);
  } catch (error) {
    throw new Error(`JSON inválido en ${path}: ${error.message}`);
  }
}

// ==========================================
// OBTENER ARCHIVO
// ==========================================

async function obtenerArchivo(tipo, agrupacion, forzar = false) {

  validarTokenGitHub();

  if (!rutas[tipo]) {
    throw new Error('Tipo no válido');
  }

  const path = tipo === 'usuarios'
    ? rutas[tipo][0]
    : rutas[tipo][Number(agrupacion)];

  if (!path) {
    throw new Error('Agrupación no válida');
  }

  const key = `${tipo}_${agrupacion || 0}`;

  if (!forzar && cacheData[key] && cacheSHA[key]) {
    return {
      data: cacheData[key],
      sha: cacheSHA[key],
      path
    };
  }

  const response = await axios.get(
    githubContentsUrl(path),
    {
      headers: githubHeaders(),
      params: { ref: branch }
    }
  );

  const data = await obtenerContenidoGitHub(response, path);
  const sha = response.data.sha;

  if (!sha) {
    throw new Error(`GitHub no devolvió SHA para ${path}`);
  }

  if (!Array.isArray(data)) {
    throw new Error(`${path} no contiene un arreglo JSON`);
  }

  cacheData[key] = data;
  cacheSHA[key] = sha;

  return { data, sha, path };
}

// ==========================================
// GUARDAR ARCHIVO JSON EN GITHUB
// ==========================================

async function guardarArchivoGitHub(path, data, sha, mensaje) {

  validarTokenGitHub();

  const inicioSerializacion = Date.now();

  const contenido = JSON.stringify(data, null, 2);

  const contenidoBase64 = Buffer
    .from(contenido, 'utf8')
    .toString('base64');

  const tiempoSerializacion = Date.now() - inicioSerializacion;

  const inicioGitHub = Date.now();

  const response = await axios.put(
    githubContentsUrl(path),
    {
      message: mensaje,
      content: contenidoBase64,
      sha,
      branch
    },
    {
      headers: githubHeaders()
    }
  );

  const tiempoGitHub = Date.now() - inicioGitHub;

  if (!response.data.content?.sha) {
    throw new Error(`GitHub no confirmó la actualización de ${path}`);
  }

  console.log('TIEMPOS GUARDADO GITHUB:', {
    archivo: path,
    serializacion: tiempoSerializacion,
    escrituraGitHub: tiempoGitHub,
    total: tiempoSerializacion + tiempoGitHub
  });

  return response.data;
}

// ==========================================
// A. ACTUALIZACIÓN SEGURA DEL DICCIONARIO
// ==========================================

// Cada intento lee la última versión del JSON.
// Si otro usuario lo modificó, se vuelve a leer y se reintenta.
// Así se conservan las actualizaciones de otros registros.

async function actualizarAudioEnDiccionario({
  agrupacion,
  variante,
  id,
  audioUrl,
  maxIntentos = 5
}) {

  const cacheKey = `diccionario_${agrupacion}`;

  for (let intento = 1; intento <= maxIntentos; intento++) {

    try {

      // No usar la caché: necesitamos la versión más reciente.
      const resultado = await obtenerArchivo(
        'diccionario',
        agrupacion,
        true
      );

      const { data, sha, path } = resultado;

      const index = data.findIndex(item =>
        String(item.idPalabra) === String(id) &&
        String(item.idDiccionario) === String(variante)
      );

      if (index === -1) {
        throw new Error(
          `No se encontró el vocablo ${id} en la variante ${variante}`
        );
      }

      // Modificar únicamente el registro solicitado.
      data[index] = {
        ...data[index],
        audioUrl
      };

      const respuesta = await guardarArchivoGitHub(
        path,
        data,
        sha,
        `Actualizar audioUrl del vocablo ${id}`
      );

      cacheData[cacheKey] = data;
      cacheSHA[cacheKey] = respuesta.content.sha;

      console.log('JSON ACTUALIZADO:', {
        id,
        agrupacion,
        variante,
        intento,
        sha: respuesta.content.sha
      });

      return {
        path,
        sha: respuesta.content.sha,
        audioUrl
      };

    } catch (error) {

      if (!esConflictoGitHub(error) || intento === maxIntentos) {
        throw error;
      }

      console.warn(
        `Conflicto al actualizar diccionario. Reintento ${intento}/${maxIntentos}`,
        error.response?.data || error.message
      );

      await esperar(150 * intento + Math.floor(Math.random() * 100));
    }
  }

  throw new Error(
    'No fue posible actualizar el diccionario después de varios intentos'
  );
}

// ==========================================
// ACTUALIZACIÓN SEGURA DE imagenUrl EN DICCIONARIO
// ==========================================


async function actualizarImagenEnDiccionario({
  agrupacion,
  variante,
  id,
  imagenUrl,
  resultadoInicial = null,
  maxIntentos = 5
}) {

  const cacheKey = `diccionario_${agrupacion}`;

  // Aprovechar la lectura anticipada cuando está disponible.
  let resultadoPendiente = resultadoInicial;

  for (let intento = 1; intento <= maxIntentos; intento++) {

    try {

      const resultado = resultadoPendiente ||
        await obtenerArchivo(
          'diccionario',
          agrupacion,
          true
        );

      // La lectura anticipada solamente se utiliza una vez.
      resultadoPendiente = null;

      const { data, sha, path } = resultado;

      // Trabajar sobre una copia para no modificar la caché
      // antes de confirmar el guardado en GitHub.
      const datosActualizados = [...data];

      const index = datosActualizados.findIndex(item =>
        String(item.idPalabra) === String(id) &&
        String(item.idDiccionario) === String(variante)
      );

      if (index === -1) {
        throw new Error(
          `No se encontró el vocablo ${id} en la variante ${variante}`
        );
      }

      datosActualizados[index] = {
        ...datosActualizados[index],
        imagenUrl
      };

      const respuesta = await guardarArchivoGitHub(
        path,
        datosActualizados,
        sha,
        `Actualizar imagenUrl del vocablo ${id}`
      );

      // Actualizar caché únicamente después de confirmar GitHub.
      cacheData[cacheKey] = datosActualizados;
      cacheSHA[cacheKey] = respuesta.content.sha;

      console.log('IMAGEN URL ACTUALIZADA:', {
        id,
        agrupacion,
        variante,
        intento,
        sha: respuesta.content.sha
      });

      return {
        path,
        sha: respuesta.content.sha,
        imagenUrl
      };

    } catch (error) {

      if (
        !esConflictoGitHub(error) ||
        intento === maxIntentos
      ) {
        throw error;
      }

      console.warn(
        `Conflicto al actualizar imagenUrl. Reintento ${intento}/${maxIntentos}`,
        error.response?.data || error.message
      );

      await esperar(
        150 * intento + Math.floor(Math.random() * 100)
      );
    }
  }

  throw new Error(
    'No fue posible actualizar imagenUrl después de varios intentos'
  );
}


// ==========================================
// VALIDACIÓN DE IMÁGENES
// ==========================================

function convertirBase64Imagen(valor) {
  if (!valor || typeof valor !== 'string') {
    throw new Error('No se recibió la imagen en Base64');
  }

  let base64 = valor.trim();

  if (/^data:/i.test(base64)) {
    const separador = base64.indexOf(',');

    if (separador === -1) {
      throw new Error('Data URL de imagen inválida');
    }

    base64 = base64.substring(separador + 1);
  }

  base64 = base64
    .replace(/\s/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new Error('Base64 de imagen inválido');
  }

  const sinPadding = base64.replace(/=+$/, '');

  if (
    sinPadding.length === 0 ||
    sinPadding.length % 4 === 1
  ) {
    throw new Error('Longitud Base64 de imagen incorrecta');
  }

  const completo = sinPadding.padEnd(
    sinPadding.length + ((4 - sinPadding.length % 4) % 4),
    '='
  );

  const buffer = Buffer.from(completo, 'base64');

  if (
    buffer.toString('base64').replace(/=+$/, '') !== sinPadding
  ) {
    throw new Error('No se pudo decodificar correctamente la imagen');
  }

  return buffer;
}

function validarFirmaImagen(buffer, extension) {
  const firmas = {
    jpg:
      buffer.length >= 3 &&
      buffer[0] === 0xFF &&
      buffer[1] === 0xD8 &&
      buffer[2] === 0xFF,

    png:
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
      ),

    webp:
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP',

    gif:
      buffer.length >= 6 &&
      ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))
  };

  return Boolean(firmas[extension]);
}

// ==========================================
// SUBIR O REEMPLAZAR IMAGEN EN GITHUB
// ==========================================

async function subirImagenGitHub({
  imagenPath,
  buffer,
  id,
  maxIntentos = 5
}) {
  validarTokenGitHub();

  const url = githubContentsUrl(imagenPath);

  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      let shaImagen;

      try {
        const existente = await axios.get(url, {
          headers: githubHeaders(),
          params: { ref: branch }
        });

        shaImagen = existente.data.sha;

      } catch (error) {
        if (error.response?.status !== 404) {
          throw error;
        }
      }

      const respuesta = await axios.put(
        url,
        {
          message: `Guardar imagen del vocablo ${id}`,
          content: buffer.toString('base64'),
          branch,
          ...(shaImagen ? { sha: shaImagen } : {})
        },
        {
          headers: githubHeaders()
        }
      );

      const versionImagen = respuesta.data.commit?.sha;

      if (
        !versionImagen ||
        !/^[a-f0-9]{40}$/i.test(versionImagen)
      ) {
        throw new Error(
          'GitHub no devolvió un SHA de commit válido para la imagen'
        );
      }

      return {
        versionImagen,
        shaImagen: respuesta.data.content?.sha
      };

    } catch (error) {
      if (!esConflictoGitHub(error) || intento === maxIntentos) {
        throw error;
      }

      console.warn(
        `Conflicto al subir imagen. Reintento ${intento}/${maxIntentos}`,
        error.response?.data || error.message
      );

      await esperar(150 * intento + Math.floor(Math.random() * 100));
    }
  }

  throw new Error(
    'No fue posible guardar la imagen después de varios intentos'
  );
}

// ==========================================
// B. BASE64 Y VALIDACIÓN DE AUDIO
// ==========================================

function convertirBase64Audio(valor) {

  if (!valor || typeof valor !== 'string') {
    throw new Error('No se recibió el audio en Base64');
  }

  let base64 = valor.trim();

  if (/^data:/i.test(base64)) {

    const separador = base64.indexOf(',');

    if (separador === -1) {
      throw new Error('Data URL inválida');
    }

    base64 = base64.substring(separador + 1);
  }

  base64 = base64
    .replace(/\s/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new Error('Base64 inválido');
  }

  const sinPadding = base64.replace(/=+$/, '');

  if (
    sinPadding.length === 0 ||
    sinPadding.length % 4 === 1
  ) {
    throw new Error('Longitud Base64 incorrecta');
  }

  const completo = sinPadding.padEnd(
    sinPadding.length +
      ((4 - sinPadding.length % 4) % 4),
    '='
  );

  const buffer = Buffer.from(completo, 'base64');

  if (
    buffer.toString('base64').replace(/=+$/, '') !== sinPadding
  ) {
    throw new Error('No se pudo decodificar correctamente el audio');
  }

  return buffer;
}

function validarFirmaAudio(buffer, extension) {

  const firmas = {

    webm:
      buffer.length >= 4 &&
      buffer.subarray(0, 4).equals(
        Buffer.from([0x1A, 0x45, 0xDF, 0xA3])
      ),

    m4a:
      buffer.length >= 8 &&
      buffer.toString('ascii', 4, 8) === 'ftyp',

    ogg:
      buffer.length >= 4 &&
      buffer.toString('ascii', 0, 4) === 'OggS',

    mp3:
      buffer.length >= 3 &&
      (
        buffer.toString('ascii', 0, 3) === 'ID3' ||
        (
          buffer[0] === 0xFF &&
          (buffer[1] & 0xE0) === 0xE0
        )
      ),

    wav:
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WAVE'
  };

  return Boolean(firmas[extension]);
}
// ==========================================
// C. SUBIR O REEMPLAZAR AUDIO CON REINTENTOS
// ==========================================

// Si dos usuarios reemplazan el mismo archivo,
// el segundo vuelve a consultar el SHA y reintenta.

async function subirAudioGitHub({
  audioPath,
  buffer,
  id,
  maxIntentos = 5
}) {

  validarTokenGitHub();

  const url = githubContentsUrl(audioPath);

  for (let intento = 1; intento <= maxIntentos; intento++) {

    try {

      let shaAudio;

      try {

        const existente = await axios.get(url, {
          headers: githubHeaders(),
          params: { ref: branch }
        });

        shaAudio = existente.data.sha;

      } catch (error) {

        if (error.response?.status !== 404) {
          throw error;
        }
      }

      const respuesta = await axios.put(
        url,
        {
          message: `Guardar audio del vocablo ${id}`,
          content: buffer.toString('base64'),
          branch,
          ...(shaAudio ? { sha: shaAudio } : {})
        },
        {
          headers: githubHeaders()
        }
      );

      const versionAudio = respuesta.data.commit?.sha;

      if (
        !versionAudio ||
        !/^[a-f0-9]{40}$/i.test(versionAudio)
      ) {
        throw new Error(
          'GitHub no devolvió un SHA de commit válido para el audio'
        );
      }

      return {
        versionAudio,
        shaAudio: respuesta.data.content?.sha
      };

    } catch (error) {

      if (!esConflictoGitHub(error) || intento === maxIntentos) {
        throw error;
      }

      console.warn(
        `Conflicto al subir audio. Reintento ${intento}/${maxIntentos}`,
        error.response?.data || error.message
      );

      await esperar(150 * intento + Math.floor(Math.random() * 100));
    }
  }

  throw new Error(
    'No fue posible guardar el audio después de varios intentos'
  );
}

// ==========================================
// GUARDAR AUDIO DEL DICCIONARIO
// ==========================================

app.post('/diccionario/:id/audio', async (req, res) => {

  let etapa = 'inicio';

  try {

    const { id } = req.params;
    const { variante, agrupacion } = req.query;
    const { audioBase64, mimeType } = req.body;

    if (!id || !variante || !agrupacion || !audioBase64) {
      return res.status(400).json({
        error: 'Faltan datos del audio o del vocablo'
      });
    }

    const nombreAgrupacion =
      agrupaciones[Number(agrupacion)];

    if (!nombreAgrupacion) {
      return res.status(400).json({
        error: 'Agrupación no válida'
      });
    }

    const tipoAudio = String(mimeType || 'audio/webm')
      .split(';')[0]
      .trim()
      .toLowerCase();

    const extension = extensionesAudio[tipoAudio];

    if (!extension) {
      return res.status(400).json({
        error: 'Formato de audio no compatible',
        mimeType
      });
    }

    etapa = 'validación del audio';

    const buffer = convertirBase64Audio(audioBase64);

    if (buffer.length < 256) {
      return res.status(400).json({
        error: 'El audio está vacío o incompleto'
      });
    }

    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(413).json({
        error: 'El audio supera el límite de 10 MB'
      });
    }

    if (!validarFirmaAudio(buffer, extension)) {
      return res.status(400).json({
        error: 'El contenido no corresponde al formato declarado',
        formato: tipoAudio
      });
    }

    const audioPath =
      `audios/${nombreAgrupacion}/${variante}/${id}.${extension}`;

    console.log('AUDIO RECIBIDO:', {
      id,
      variante,
      agrupacion,
      extension,
      bytes: buffer.length
    });

    // 1. Subir el audio a GitHub.
    etapa = 'subida del audio';

    const resultadoAudio = await subirAudioGitHub({
      audioPath,
      buffer,
      id
    });

    // 2. Crear URL inmutable con SHA de commit.
    etapa = 'generación de audioUrl';

    const audioUrl =
      `${BASE_URL}/diccionario/${encodeURIComponent(id)}/audio` +
      `?variante=${encodeURIComponent(variante)}` +
      `&agrupacion=${encodeURIComponent(agrupacion)}` +
      `&formato=${encodeURIComponent(extension)}` +
      `&version=${encodeURIComponent(resultadoAudio.versionAudio)}`;

    // 3. Actualizar JSON con control de conflictos.
    etapa = 'actualización segura del diccionario';

    const resultadoJSON = await actualizarAudioEnDiccionario({
      agrupacion,
      variante,
      id,
      audioUrl,
      maxIntentos: 5
    });

    console.log('========== AUDIO GUARDADO ==========');

    console.log({
      id,
      variante,
      agrupacion,
      bytes: buffer.length,
      versionAudio: resultadoAudio.versionAudio,
      archivoJSON: resultadoJSON.path
    });

    return res.json({
      mensaje: 'Audio y audioUrl guardados correctamente',
      audioUrl,
      versionAudio: resultadoAudio.versionAudio,
      archivoJSON: resultadoJSON.path,
      bytes: buffer.length,
      guardadoGitHub: true
    });

  } catch (error) {

    console.error('ERROR AL GUARDAR AUDIO:', {
      etapa,
      mensaje: error.message,
      status: error.response?.status,
      github: error.response?.data
    });

    return res.status(
      esConflictoGitHub(error) ? 409 : 500
    ).json({
      error: 'No fue posible completar el guardado del audio',
      etapa,
      detalle:
        error.response?.data?.message ||
        error.message,
      codigoGitHub: error.response?.status || null
    });
  }
});

// ==========================================
// GUARDAR IMAGEN DEL DICCIONARIO
// ==========================================


app.post('/diccionario/:id/imagen', async (req, res) => {

  let etapa = 'inicio';

  try {

    const { id } = req.params;
    const { variante, agrupacion } = req.query;
    const { imagenBase64, mimeType } = req.body;

    if (!id || !variante || !agrupacion || !imagenBase64) {
      return res.status(400).json({
        error: 'Faltan datos de la imagen o del vocablo'
      });
    }

    if (
      !/^\d+$/.test(String(id)) ||
      !/^\d+$/.test(String(variante))
    ) {
      return res.status(400).json({
        error: 'El identificador o la variante no son válidos'
      });
    }

    const nombreAgrupacion =
      agrupaciones[Number(agrupacion)];

    if (!nombreAgrupacion) {
      return res.status(400).json({
        error: 'Agrupación no válida'
      });
    }

    const tipoImagen = String(mimeType || '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    const extension = extensionesImagen[tipoImagen];

    if (!extension) {
      return res.status(400).json({
        error: 'Formato de imagen no compatible. Utiliza JPG, PNG, WEBP o GIF',
        mimeType
      });
    }

    // VALIDAR IMAGEN

    etapa = 'validación de la imagen';

    const buffer = convertirBase64Imagen(imagenBase64);

    if (buffer.length < 16) {
      return res.status(400).json({
        error: 'La imagen está vacía o incompleta'
      });
    }

    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({
        error: 'La imagen supera el límite de 5 MB'
      });
    }

    if (!validarFirmaImagen(buffer, extension)) {
      return res.status(400).json({
        error: 'El contenido no corresponde al formato de imagen declarado',
        formato: tipoImagen
      });
    }

    const imagenPath =
      `imagenes/${nombreAgrupacion}/${variante}/${id}.${extension}`;

    console.log('IMAGEN RECIBIDA:', {
      id,
      variante,
      agrupacion,
      extension,
      bytes: buffer.length
    });

    // ==========================================
    // OPERACIONES SIMULTÁNEAS
    // ==========================================

    etapa = 'subida de imagen y lectura del diccionario';

    const inicioImagen = Date.now();
    const inicioJSON = Date.now();

    // Operación 1: guardar imagen en GitHub.
    const promesaImagen = subirImagenGitHub({
      imagenPath,
      buffer,
      id
    }).then(resultado => {

      console.log('TIEMPO SUBIDA IMAGEN:', {
        milisegundos: Date.now() - inicioImagen
      });

      return resultado;
    });

    // Operación 2: leer la versión más reciente del JSON.
    const promesaJSON = obtenerArchivo(
      'diccionario',
      agrupacion,
      true
    ).then(resultado => {

      console.log('TIEMPO LECTURA JSON:', {
        milisegundos: Date.now() - inicioJSON
      });

      return resultado;
    });

    // Ambas operaciones comienzan sin esperar una a la otra.
    const [
      resultadoImagen,
      resultadoJSONInicial
    ] = await Promise.all([
      promesaImagen,
      promesaJSON
    ]);

    // ==========================================
    // GENERAR URL INMUTABLE
    // ==========================================

    etapa = 'generación de imagenUrl';

    const rutaCodificada = imagenPath
      .split('/')
      .map(segment => encodeURIComponent(segment))
      .join('/');

    const imagenUrl =
      `https://raw.githubusercontent.com/${owner}/${repo}/` +
      `${resultadoImagen.versionImagen}/${rutaCodificada}`;

    // ==========================================
    // ACTUALIZAR JSON
    // ==========================================

    etapa = 'actualización segura del diccionario';

    const inicioActualizacionJSON = Date.now();

    const resultadoJSON = await actualizarImagenEnDiccionario({
      agrupacion,
      variante,
      id,
      imagenUrl,
      resultadoInicial: resultadoJSONInicial,
      maxIntentos: 5
    });

    console.log('TIEMPO ACTUALIZACIÓN JSON:', {
      milisegundos: Date.now() - inicioActualizacionJSON
    });

    // ==========================================
    // CONFIRMACIÓN
    // ==========================================

    console.log('========== IMAGEN GUARDADA ==========');

    console.log({
      id,
      variante,
      agrupacion,
      bytes: buffer.length,
      versionImagen: resultadoImagen.versionImagen,
      archivoJSON: resultadoJSON.path
    });

    return res.json({
      mensaje: 'Imagen y imagenUrl guardadas correctamente',
      imagenUrl,
      versionImagen: resultadoImagen.versionImagen,
      archivoJSON: resultadoJSON.path,
      bytes: buffer.length,
      guardadoGitHub: true
    });

  } catch (error) {

    console.error('ERROR AL GUARDAR IMAGEN:', {
      etapa,
      mensaje: error.message,
      status: error.response?.status,
      github: error.response?.data
    });

    return res.status(
      esConflictoGitHub(error) ? 409 : 500
    ).json({
      error: 'No fue posible completar el guardado de la imagen',
      etapa,
      detalle:
        error.response?.data?.message ||
        error.message,
      codigoGitHub: error.response?.status || null
    });
  }
});

    
    // ==========================================
    // REPRODUCIR AUDIO
    // ==========================================
    
    app.get('/diccionario/:id/audio', async (req, res) => {
    
      try {
    
        const { id } = req.params;
    
        const {
          variante,
          agrupacion,
          formato,
          version
        } = req.query;
    
        const nombreAgrupacion =
          agrupaciones[Number(agrupacion)];
    
        if (!nombreAgrupacion || !variante || !id) {
          return res.status(400).json({
            error: 'Parámetros incompletos'
          });
        }
    
        let referenciaGitHub = branch;
    
        if (version !== undefined) {
    
          if (
            typeof version !== 'string' ||
            !/^[a-f0-9]{40}$/i.test(version)
          ) {
            return res.status(400).json({
              error: 'Versión del audio no válida'
            });
          }
    
          referenciaGitHub = version;
        }
    
        const disponibles = ['webm', 'm4a', 'ogg', 'mp3', 'wav'];
    
        const solicitado = String(formato || '').toLowerCase();
    
        if (solicitado && !disponibles.includes(solicitado)) {
          return res.status(400).json({
            error: 'Formato no válido'
          });
        }
    
        const extensiones = solicitado
          ? [
              solicitado,
              ...disponibles.filter(e => e !== solicitado)
            ]
          : disponibles;
    
        let audio = null;
        let extensionEncontrada = null;
    
        for (const extension of extensiones) {
    
          const path =
            `audios/${nombreAgrupacion}/${variante}/${id}.${extension}`;
    
          const url =
            `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(referenciaGitHub)}/${path
              .split('/')
              .map(segment => encodeURIComponent(segment))
              .join('/')}`;
    
          try {
    
            const respuesta = await axios.get(url, {
              responseType: 'arraybuffer',
              headers: {
                'Cache-Control': 'no-cache'
              },
              validateStatus: status => status === 200
            });
    
            if (respuesta.data?.byteLength > 0) {
              audio = Buffer.from(respuesta.data);
              extensionEncontrada = extension;
              break;
            }
    
          } catch (error) {
    
            if (error.response?.status !== 404) {
              throw error;
            }
          }
        }
    
        if (!audio) {
          return res.status(404).json({
            error: 'Audio no encontrado'
          });
        }
    
        const tamano = audio.length;
        const range = req.headers.range;
    
        res.set({
          'Content-Type': tiposMime[extensionEncontrada],
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'X-Content-Type-Options': 'nosniff'
        });
    
        if (range) {
    
          const coincidencia = /^bytes=(\d*)-(\d*)$/.exec(range);
    
          if (!coincidencia) {
            return res.status(416)
              .set('Content-Range', `bytes */${tamano}`)
              .end();
          }
    
          let inicio;
          let fin;
    
          if (coincidencia[1] === '') {
    
            const cantidad = Number(coincidencia[2]);
    
            if (!cantidad || cantidad <= 0) {
              return res.status(416)
                .set('Content-Range', `bytes */${tamano}`)
                .end();
            }
    
            inicio = Math.max(0, tamano - cantidad);
            fin = tamano - 1;
    
          } else {
    
            inicio = Number(coincidencia[1]);
            fin = coincidencia[2]
              ? Number(coincidencia[2])
              : tamano - 1;
          }
    
          if (
            !Number.isSafeInteger(inicio) ||
            !Number.isSafeInteger(fin) ||
            inicio < 0 ||
            inicio >= tamano ||
            fin < inicio
          ) {
            return res.status(416)
              .set('Content-Range', `bytes */${tamano}`)
              .end();
          }
    
          fin = Math.min(fin, tamano - 1);
    
          const fragmento = audio.subarray(inicio, fin + 1);
    
          res.status(206);
    
          res.set({
            'Content-Length': fragmento.length,
            'Content-Range': `bytes ${inicio}-${fin}/${tamano}`
          });
    
          return res.end(fragmento);
        }
    
        res.set('Content-Length', tamano);
    
        return res.status(200).end(audio);
    
      } catch (error) {
    
        console.error(
          'ERROR AL REPRODUCIR AUDIO:',
          error.response?.data || error.message
        );
    
        return res.status(500).json({
          error: 'No fue posible recuperar el audio',
          detalle: error.message
        });
      }
    });
    
    // ==========================================
    // RECUPERAR AUDIOS EXISTENTES
    // ==========================================
    
    async function recuperarAudiosExistentes(agrupacion) {
    
      const nombreAgrupacion =
        agrupaciones[Number(agrupacion)];
    
      if (!nombreAgrupacion) {
        throw new Error('Agrupación no válida');
      }
    
      const { data, sha, path } =
        await obtenerArchivo('diccionario', agrupacion, true);
    
      const variantes = [
        ...new Set(
          data.map(item => String(item.idDiccionario || ''))
            .filter(Boolean)
        )
      ];
    
      const archivos = {};
    
      for (const variante of variantes) {
    
        const carpeta =
          `audios/${nombreAgrupacion}/${variante}`;
    
        archivos[variante] = {};
    
        try {
    
          const respuesta = await axios.get(
            githubContentsUrl(carpeta),
            {
              headers: githubHeaders(),
              params: { ref: branch }
            }
          );
    
          if (!Array.isArray(respuesta.data)) {
            continue;
          }
    
          for (const archivo of respuesta.data) {
    
            if (archivo.type !== 'file') continue;
    
            const match = archivo.name.match(
              /^(\d+)\.(webm|m4a|ogg|mp3|wav)$/i
            );
    
            if (!match) continue;
    
            const id = match[1];
            const extension = match[2].toLowerCase();
    
            if (!archivos[variante][id]) {
              archivos[variante][id] = extension;
            }
          }
    
        } catch (error) {
    
          if (error.response?.status !== 404) {
            throw error;
          }
        }
      }
    
      let recuperados = 0;
    
      for (const item of data) {
    
        const variante = String(item.idDiccionario);
        const id = String(item.idPalabra);
    
        const extension = archivos[variante]?.[id];
    
        if (!extension) continue;
    
        item.audioUrl =
          `${BASE_URL}/diccionario/${encodeURIComponent(id)}/audio` +
          `?variante=${encodeURIComponent(variante)}` +
          `&agrupacion=${encodeURIComponent(agrupacion)}` +
          `&formato=${encodeURIComponent(extension)}`;
    
        recuperados++;
      }
    
      if (recuperados > 0) {
    
        const respuesta = await guardarArchivoGitHub(
          path,
          data,
          sha,
          `Recuperar audios de ${nombreAgrupacion}`
        );
    
        cacheData[`diccionario_${agrupacion}`] = data;
        cacheSHA[`diccionario_${agrupacion}`] =
          respuesta.content.sha;
      }
    
      return {
        agrupacion: nombreAgrupacion,
        registros: data.length,
        recuperados
      };
    }
    app.post('/recuperar-audios/:agrupacion', async (req, res) => {

      try {
    
        const configurada = process.env.AUDIO_RECOVERY_SECRET;
        const recibida = req.headers['x-recovery-secret'];
    
        if (!configurada) {
          return res.status(500).json({
            error: 'Falta configurar AUDIO_RECOVERY_SECRET'
          });
        }
    
        if (
          typeof recibida !== 'string' ||
          Buffer.byteLength(recibida) !== Buffer.byteLength(configurada) ||
          !crypto.timingSafeEqual(
            Buffer.from(recibida),
            Buffer.from(configurada)
          )
        ) {
          return res.status(401).json({
            error: 'No autorizado'
          });
        }
    
        const agrupacion = Number(req.params.agrupacion);
    
        if (![1, 2].includes(agrupacion)) {
          return res.status(400).json({
            error: 'Agrupación no válida'
          });
        }
    
        const resultado =
          await recuperarAudiosExistentes(agrupacion);
    
        return res.json({
          mensaje: 'Recuperación completada',
          resultado
        });
    
      } catch (error) {
    
        console.error('ERROR RECUPERACIÓN:', error.message);
    
        return res.status(500).json({
          error: error.message
        });
      }
    });
    
    // ==========================================
    // LOGIN
    // ==========================================
    
    app.post('/login', async (req, res) => {
    
      try {
    
        const { correoElectronico, contraseña } = req.body;
    
        if (!correoElectronico || !contraseña) {
          return res.status(400).json({
            error: 'Faltan credenciales'
          });
        }
    
        const { data } = await obtenerArchivo('usuarios', 0, true);
    
        const usuario = data.find(u =>
          u.correoElectronico === correoElectronico
        );
    
        if (!usuario) {
          return res.status(401).json({
            error: 'Usuario no encontrado'
          });
        }
    
        const valido = await bcrypt.compare(
          contraseña,
          usuario.contraseña
        );
    
        if (!valido) {
          return res.status(401).json({
            error: 'Contraseña incorrecta'
          });
        }
    
        if (!process.env.JWT_SECRET) {
          throw new Error('Falta configurar JWT_SECRET');
        }
    
        const token = jwt.sign(
          {
            correoElectronico: usuario.correoElectronico,
            rol: usuario.rol
          },
          process.env.JWT_SECRET,
          { expiresIn: '8h' }
        );
    
        return res.json({
          mensaje: 'Login exitoso',
          token,
          usuario: {
            nombre: usuario.nombre,
            correoElectronico: usuario.correoElectronico,
            rol: usuario.rol,
            activo: usuario.activo
          }
        });
    
      } catch (error) {
    
        console.error('ERROR LOGIN:', error.message);
    
        return res.status(500).json({
          error: error.message
        });
      }
    });
    
    // ==========================================
    // REGISTRO DE USUARIOS
    // ==========================================
    
    app.post('/usuarios', async (req, res) => {
    
      try {
    
        const {
          nombre,
          correoElectronico,
          contraseña,
          rol
        } = req.body;
    
        if (!nombre || !correoElectronico || !contraseña) {
          return res.status(400).json({
            error: 'Faltan datos'
          });
        }
    
        const { data, sha, path } =
          await obtenerArchivo('usuarios', 0, true);
    
        if (data.some(u =>
          u.correoElectronico === correoElectronico
        )) {
          return res.status(409).json({
            error: 'El usuario ya existe'
          });
        }
    
        const hash = await bcrypt.hash(contraseña, 10);
    
        data.push({
          nombre,
          correoElectronico,
          contraseña: hash,
          rol: rol || 'usuario',
          activo: false
        });
    
        const respuesta = await guardarArchivoGitHub(
          path,
          data,
          sha,
          'Nuevo usuario'
        );
    
        cacheData.usuarios_0 = data;
        cacheSHA.usuarios_0 = respuesta.content.sha;
    
        return res.json({
          mensaje: 'Usuario creado correctamente'
        });
    
      } catch (error) {
    
        console.error('ERROR REGISTRO:', error.message);
    
        return res.status(500).json({
          error: error.message
        });
      }
    });
    
    // ==========================================
    // ACTUALIZAR USUARIO
    // ==========================================
    
    app.put('/usuarios/:correo', async (req, res) => {
    
      try {
    
        const { correo } = req.params;
    
        const { data, sha, path } =
          await obtenerArchivo('usuarios', 0, true);
    
        const index = data.findIndex(
          u => u.correoElectronico === correo
        );
    
        if (index === -1) {
          return res.status(404).json({
            error: 'Usuario no encontrado'
          });
        }
    
        data[index] = {
          ...data[index],
          ...req.body
        };
    
        const respuesta = await guardarArchivoGitHub(
          path,
          data,
          sha,
          `Actualizar usuario ${correo}`
        );
    
        cacheData.usuarios_0 = data;
        cacheSHA.usuarios_0 = respuesta.content.sha;
    
        return res.json({
          mensaje: 'Usuario actualizado'
        });
    
      } catch (error) {
    
        console.error('ERROR ACTUALIZAR USUARIO:', error.message);
    
        return res.status(500).json({
          error: error.message
        });
      }
    });
    
    // ==========================================
    // ELIMINAR USUARIO
    // ==========================================
    
    app.delete('/usuarios/:correo', async (req, res) => {
    
      try {
    
        const { correo } = req.params;
    
        const { data, sha, path } =
          await obtenerArchivo('usuarios', 0, true);
    
        const nuevoArray = data.filter(
          u => u.correoElectronico !== correo
        );
    
        const respuesta = await guardarArchivoGitHub(
          path,
          nuevoArray,
          sha,
          `Eliminar usuario ${correo}`
        );
    
        cacheData.usuarios_0 = nuevoArray;
        cacheSHA.usuarios_0 = respuesta.content.sha;
    
        return res.json({
          mensaje: 'Usuario eliminado'
        });
    
      } catch (error) {
    
        console.error('ERROR ELIMINAR USUARIO:', error.message);
    
        return res.status(500).json({
          error: error.message
        });
      }
    });
    // ==========================================
// CREAR REGISTRO EN DICCIONARIO O CORPUS
// ==========================================

// ==========================================
// CREAR NUEVO REGISTRO
// ==========================================

app.post('/:tipo', async (req, res) => {

  try {

    const { tipo } = req.params;
    const { agrupacion } = req.query;

    if (!['diccionario', 'corpus'].includes(tipo)) {
      return res.status(400).json({
        error: 'Tipo no válido'
      });
    }

    if (!agrupacion) {
      return res.status(400).json({
        error: 'Debe especificar una agrupación'
      });
    }

    // ==========================================
    // OBTENER ARCHIVO JSON
    // ==========================================

    const { data, sha, path } =
      await obtenerArchivo(tipo, agrupacion, true);

    // ==========================================
    // VALIDAR CAMPOS DEL DICCIONARIO
    // ==========================================

    if (tipo === 'diccionario') {

      const nombreNuevo = String(
        req.body.nombrePalabra || ''
      )
        .trim()
        .toLocaleLowerCase();

      if (!nombreNuevo) {
        return res.status(400).json({
          error: 'El nombre del vocablo es obligatorio'
        });
      }

      // ==========================================
      // BUSCAR VOCABLO DUPLICADO
      // ==========================================

      const duplicado = data.find(item => {

        const nombreExistente = String(
          item.nombrePalabra || ''
        )
          .trim()
          .toLocaleLowerCase();

        const mismaVariante =
          String(item.idDiccionario) ===
          String(req.body.idDiccionario);

        return (
          mismaVariante &&
          nombreExistente === nombreNuevo
        );

      });

      if (duplicado) {

        return res.status(409).json({

          mensaje:
            'El vocablo ya existe en esta variante lingüística.',

          duplicado: true,

          idPalabra: duplicado.idPalabra,

          nombrePalabra: duplicado.nombrePalabra

        });

      }

    }

    // ==========================================
    // GENERAR IDENTIFICADOR
    // ==========================================

    const campoId = tipo === 'diccionario'
      ? 'idPalabra'
      : 'idExpresion';

    const nuevoId = data.length
      ? Math.max(
          ...data.map(item =>
            Number(item[campoId]) || 0
          )
        ) + 1
      : 1;

    // ==========================================
    // CONSTRUIR NUEVO REGISTRO
    // ==========================================

    const nuevoRegistro = {
      ...req.body,
      [campoId]: String(nuevoId)
    };

    data.push(nuevoRegistro);

    // ==========================================
    // GUARDAR EN GITHUB
    // ==========================================

    const respuesta = await guardarArchivoGitHub(
      path,
      data,
      sha,
      `Nuevo registro en ${tipo}`
    );

    // ==========================================
    // ACTUALIZAR CACHÉ
    // ==========================================

    cacheData[`${tipo}_${agrupacion}`] = data;

    cacheSHA[`${tipo}_${agrupacion}`] =
      respuesta.content.sha;

    return res.json({

      mensaje: 'Registro creado correctamente',

      id: nuevoId

    });

  } catch (error) {

    console.error(
      'ERROR CREAR REGISTRO:',
      error.message
    );

    return res.status(500).json({
      error: error.message
    });

  }

});

// ==========================================
// ACTUALIZAR REGISTRO
// ==========================================

app.put('/:tipo/:id', async (req, res) => {

  try {

    const { tipo, id } = req.params;
    const { variante, agrupacion } = req.query;

    if (!['diccionario', 'corpus'].includes(tipo)) {
      return res.status(400).json({
        error: 'Tipo no válido'
      });
    }

    const { data, sha, path } =
      await obtenerArchivo(tipo, agrupacion, true);

    const campoId = tipo === 'diccionario'
      ? 'idPalabra'
      : 'idExpresion';

    const index = data.findIndex(item =>
      String(item[campoId]) === String(id) &&
      String(item.idDiccionario) === String(variante)
    );

    if (index === -1) {
      return res.status(404).json({
        error: 'Registro no encontrado'
      });
    }

    const audioAnterior = data[index].audioUrl;

    data[index] = {
      ...data[index],
      ...req.body
    };

    if (
      tipo === 'diccionario' &&
      !req.body.audioUrl &&
      audioAnterior
    ) {
      data[index].audioUrl = audioAnterior;
    }

    const respuesta = await guardarArchivoGitHub(
      path,
      data,
      sha,
      `Actualizar ${tipo} ${id}`
    );

    cacheData[`${tipo}_${agrupacion}`] = data;
    cacheSHA[`${tipo}_${agrupacion}`] =
      respuesta.content.sha;

    return res.json({
      mensaje: 'Registro actualizado correctamente',
      audioUrl: data[index].audioUrl || null
    });

  } catch (error) {

    console.error('ERROR ACTUALIZAR REGISTRO:', error.message);

    return res.status(500).json({
      error: error.message
    });
  }
});

// ==========================================
// ELIMINAR REGISTRO
// ==========================================

app.delete('/:tipo/:id', async (req, res) => {

  try {

    const { tipo, id } = req.params;
    const { agrupacion } = req.query;

    if (!['diccionario', 'corpus'].includes(tipo)) {
      return res.status(400).json({
        error: 'Tipo no válido'
      });
    }

    const { data, sha, path } =
      await obtenerArchivo(tipo, agrupacion, true);

    const campoId = tipo === 'diccionario'
      ? 'idPalabra'
      : 'idExpresion';

    const nuevoArray = data.filter(item =>
      String(item[campoId]) !== String(id)
    );

    const respuesta = await guardarArchivoGitHub(
      path,
      nuevoArray,
      sha,
      `Eliminar ${tipo} ${id}`
    );

    cacheData[`${tipo}_${agrupacion}`] = nuevoArray;
    cacheSHA[`${tipo}_${agrupacion}`] =
      respuesta.content.sha;

    return res.json({
      mensaje: 'Registro eliminado correctamente'
    });

  } catch (error) {

    console.error('ERROR ELIMINAR REGISTRO:', error.message);

    return res.status(500).json({
      error: error.message
    });
  }
});

// ==========================================
// CONSULTAR DICCIONARIO, CORPUS Y USUARIOS
// ==========================================

app.get('/:tipo', async (req, res) => {

  try {

    const { tipo } = req.params;

    const {
      variante,
      agrupacion,
      pagina,
      limite,
      q
    } = req.query;

    if (!['diccionario', 'corpus', 'usuarios'].includes(tipo)) {
      return res.status(400).json({
        error: 'Tipo no válido'
      });
    }

    if (tipo !== 'usuarios' && !agrupacion) {
      return res.status(400).json({
        error: 'Debe enviar agrupacion'
      });
    }

    const { data } = await obtenerArchivo(
      tipo,
      agrupacion || 0,
      false
    );

    let resultado = data;

    if (tipo === 'diccionario') {

      resultado = resultado.map(item => ({
        ...item,
        audioUrl:
          typeof item.audioUrl === 'string' &&
          item.audioUrl.trim()
            ? item.audioUrl.trim()
            : null,
        imagenUrl:
          typeof item.imagenUrl === 'string' &&
          item.imagenUrl.trim()
            ? item.imagenUrl.trim()
            : null
      }));
    }

    if (variante) {

      const campo = tipo === 'diccionario'
        ? 'idDiccionario'
        : 'idCorpus';

      if (tipo !== 'usuarios') {
        resultado = resultado.filter(item =>
          String(item[campo]) === String(variante)
        );
      }
    }

    if (q) {

      const normalizar = valor =>
        String(valor || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();

      const busqueda = normalizar(q);

      resultado = resultado.filter(item => {

        const campos = tipo === 'diccionario'
          ? [
              item.nombrePalabra,
              item.traduccion,
              item.lexema,
              item.gramema,
              item.categoriaGramatical
            ]
          : Object.values(item);

        return campos.some(valor =>
          normalizar(valor).includes(busqueda)
        );
      });
    }

    const solicitaPaginacion =
      pagina !== undefined ||
      limite !== undefined ||
      q !== undefined;

    if (!solicitaPaginacion) {
      return res.json(resultado);
    }

    const paginaActual = Math.max(
      1,
      parseInt(pagina, 10) || 1
    );

    const limiteActual = Math.min(
      100,
      Math.max(1, parseInt(limite, 10) || 100)
    );

    const total = resultado.length;
    const inicio = (paginaActual - 1) * limiteActual;

    const datos = resultado.slice(
      inicio,
      inicio + limiteActual
    );

    return res.json({
      datos,
      pagina: paginaActual,
      limite: limiteActual,
      total,
      hayMas: inicio + datos.length < total
    });

  } catch (error) {

    console.error('ERROR CONSULTA:', error.message);

    return res.status(500).json({
      error: error.message
    });
  }
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`UMAR Multilingua activo en puerto ${PORT}`);
});
