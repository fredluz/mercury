#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'brand/source/mercury-logo-source.png')

const committedOutputs = {
  buildPng: join(root, 'build/icon.png'),
  ico: join(root, 'build/icon.ico'),
  icns: join(root, 'build/icon.icns'),
  resourcesPng: join(root, 'resources/icon.png'),
  rendererPng: join(root, 'src/renderer/src/assets/icon.png'),
  docsPng: join(root, 'docs/assets/mercury-logo.png'),
  nightlyBuildPng: join(root, 'build/nightly-icon.png'),
  nightlyIco: join(root, 'build/nightly-icon.ico'),
  nightlyIcns: join(root, 'build/nightly-icon.icns'),
  nightlyResourcesPng: join(root, 'resources/nightly-icon.png'),
  nightlyRendererPng: join(root, 'src/renderer/src/assets/nightly-icon.png'),
  nightlyDocsPng: join(root, 'docs/assets/mercury-nightly-logo.png')
}

const checkMode = process.argv.includes('--check')
const generatedRoot = checkMode ? mkdtempSync(join(tmpdir(), 'mercury-brand-check-')) : root
const outputs = checkMode
  ? {
      buildPng: join(generatedRoot, 'build/icon.png'),
      ico: join(generatedRoot, 'build/icon.ico'),
      icns: join(generatedRoot, 'build/icon.icns'),
      resourcesPng: join(generatedRoot, 'resources/icon.png'),
      rendererPng: join(generatedRoot, 'src/renderer/src/assets/icon.png'),
      docsPng: join(generatedRoot, 'docs/assets/mercury-logo.png'),
      nightlyBuildPng: join(generatedRoot, 'build/nightly-icon.png'),
      nightlyIco: join(generatedRoot, 'build/nightly-icon.ico'),
      nightlyIcns: join(generatedRoot, 'build/nightly-icon.icns'),
      nightlyResourcesPng: join(generatedRoot, 'resources/nightly-icon.png'),
      nightlyRendererPng: join(generatedRoot, 'src/renderer/src/assets/nightly-icon.png'),
      nightlyDocsPng: join(generatedRoot, 'docs/assets/mercury-nightly-logo.png')
    }
  : committedOutputs

const sourceSha256 = 'd697e607e176f16aca1e752009d0b7faaa600735cc802f219e7a62e87156cc33'
const sourceWidth = 1254
const sourceHeight = 1254

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' })
}

function ensureTool(command) {
  try {
    execFileSync('/usr/bin/which', [command], { stdio: 'ignore' })
  } catch {
    throw new Error(`Missing required tool: ${command}`)
  }
}

function ensurePythonPillow() {
  try {
    execFileSync('python3', ['-c', 'import PIL.Image, PIL.ImageOps'], { stdio: 'ignore' })
  } catch {
    throw new Error('Missing required Python package: Pillow. Install it with `python3 -m pip install Pillow`.')
  }
}

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true })
}

function resizePng(input, outputPath, size) {
  ensureParent(outputPath)
  copyFileSync(input, outputPath)
  run('sips', ['-z', String(size), String(size), outputPath])
}

function invertPng(input, outputPath) {
  ensureParent(outputPath)
  execFileSync(
    'python3',
    [
      '-c',
      `from PIL import Image, ImageOps\nimport sys\nim = Image.open(sys.argv[1]).convert('RGBA')\nr, g, b, a = im.split()\nrgb = Image.merge('RGB', (r, g, b))\ninverted = ImageOps.invert(rgb)\nout = Image.merge('RGBA', (*inverted.split(), a))\nout.save(sys.argv[2])`,
      input,
      outputPath
    ],
    { stdio: 'inherit' }
  )
}

function makeIco(pngPaths, outputPath) {
  const images = pngPaths.map((path) => readFileSync(path))
  const headerSize = 6
  const directorySize = images.length * 16
  let offset = headerSize + directorySize
  const chunks = []
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  chunks.push(header)

  for (let index = 0; index < images.length; index += 1) {
    const png = images[index]
    const size = Number.parseInt(pngPaths[index].match(/icon_(\d+)x\d+\.png$/)?.[1] ?? '256', 10)
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    chunks.push(entry)
    offset += png.length
  }

  chunks.push(...images)
  ensureParent(outputPath)
  writeFileSync(outputPath, Buffer.concat(chunks))
}

function assertNonEmpty(path) {
  if (!existsSync(path) || statSync(path).size === 0) {
    throw new Error(`Expected generated file to exist and be non-empty: ${path}`)
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function pngDimensions(path) {
  const png = readFileSync(path)
  if (png.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`Expected PNG source: ${path}`)
  }
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20)
  }
}

function assertSameBytes(actualPath, expectedPath) {
  assertNonEmpty(actualPath)
  assertNonEmpty(expectedPath)
  const actual = readFileSync(actualPath)
  const expected = readFileSync(expectedPath)
  if (!actual.equals(expected)) {
    throw new Error(`Generated asset is not in sync: ${expectedPath}`)
  }
}

if (!existsSync(source)) {
  throw new Error(`Missing canonical source image: ${source}`)
}

ensureTool('sips')
ensureTool('iconutil')
ensurePythonPillow()

const actualSha = sha256(source)
if (actualSha !== sourceSha256) {
  throw new Error(`Canonical source hash mismatch. Expected ${sourceSha256}, got ${actualSha}`)
}

const dimensions = pngDimensions(source)
if (dimensions.width !== sourceWidth || dimensions.height !== sourceHeight) {
  throw new Error(`Canonical source dimensions changed. Expected ${sourceWidth}x${sourceHeight}, got ${dimensions.width}x${dimensions.height}`)
}

const tmp = mkdtempSync(join(tmpdir(), 'mercury-brand-'))
try {
  const invertedSource = join(tmp, 'mercury-logo-source-inverted.png')
  invertPng(source, invertedSource)

  resizePng(source, outputs.buildPng, 1024)
  resizePng(source, outputs.resourcesPng, 512)
  resizePng(source, outputs.rendererPng, 512)
  resizePng(source, outputs.docsPng, 1024)
  resizePng(invertedSource, outputs.nightlyBuildPng, 1024)
  resizePng(invertedSource, outputs.nightlyResourcesPng, 512)
  resizePng(invertedSource, outputs.nightlyRendererPng, 512)
  resizePng(invertedSource, outputs.nightlyDocsPng, 1024)

  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const icoPngs = icoSizes.map((size) => {
    const path = join(tmp, `icon_${size}x${size}.png`)
    resizePng(source, path, size)
    return path
  })
  makeIco(icoPngs, outputs.ico)

  const nightlyIcoPngs = icoSizes.map((size) => {
    const path = join(tmp, `nightly_icon_${size}x${size}.png`)
    resizePng(invertedSource, path, size)
    return path
  })
  makeIco(nightlyIcoPngs, outputs.nightlyIco)

  const iconset = join(tmp, 'icon.iconset')
  mkdirSync(iconset, { recursive: true })
  const icnsEntries = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024]
  ]
  for (const [name, size] of icnsEntries) {
    resizePng(source, join(iconset, name), size)
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', outputs.icns])

  const nightlyIconset = join(tmp, 'nightly.iconset')
  mkdirSync(nightlyIconset, { recursive: true })
  for (const [name, size] of icnsEntries) {
    resizePng(invertedSource, join(nightlyIconset, name), size)
  }
  run('iconutil', ['-c', 'icns', nightlyIconset, '-o', outputs.nightlyIcns])

  for (const path of Object.values(outputs)) {
    assertNonEmpty(path)
  }

  if (checkMode) {
    for (const key of Object.keys(committedOutputs)) {
      assertSameBytes(outputs[key], committedOutputs[key])
    }
    console.log('Mercury brand assets are in sync.')
  } else {
    console.log('Generated Mercury brand assets:')
    for (const [name, path] of Object.entries(outputs)) {
      console.log(`- ${name}: ${path}`)
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
  if (checkMode) {
    rmSync(generatedRoot, { recursive: true, force: true })
  }
}
