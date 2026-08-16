import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif'])
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const applicationDirectory = path.resolve(scriptDirectory, '..')
const workspaceDirectory = path.resolve(applicationDirectory, '..')
const sourceDirectory = path.join(workspaceDirectory, '插画')
const outputDirectory = path.join(applicationDirectory, 'public', 'images', 'login-illustrations')
const manifestPath = path.join(outputDirectory, 'manifest.json')

async function collectIllustrations(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const illustrations = []

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        illustrations.push(...await collectIllustrations(entryPath))
      } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        illustrations.push(entryPath)
      }
    }

    return illustrations
  } catch (error) {
    if (directory === sourceDirectory) {
      console.warn(`未找到登录插画目录，继续使用默认插画：${sourceDirectory}`)
      return []
    }
    throw error
  }
}

function toPublicAssetPath(relativePath) {
  const encodedPath = relativePath
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `/images/login-illustrations/${encodedPath}`
}

function isWithinDirectory(directory, candidate) {
  const relativePath = path.relative(directory, candidate)
  return relativePath && !relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath)
}

async function syncIllustrations() {
  const sourceFiles = await collectIllustrations(sourceDirectory)
  const publicAssets = []

  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(outputDirectory, { recursive: true })

  for (const sourceFile of sourceFiles.sort()) {
    const relativePath = path.relative(sourceDirectory, sourceFile)
    const destination = path.resolve(outputDirectory, relativePath)
    if (!isWithinDirectory(outputDirectory, destination)) {
      throw new Error(`插画路径超出目标目录：${relativePath}`)
    }

    try {
      await mkdir(path.dirname(destination), { recursive: true })
      await copyFile(sourceFile, destination)
      publicAssets.push(toPublicAssetPath(relativePath))
    } catch (error) {
      console.warn(`跳过无法同步的插画：${sourceFile}`, error)
    }
  }

  await writeFile(manifestPath, `${JSON.stringify({ images: publicAssets }, null, 2)}\n`, 'utf8')
  console.log(`已同步 ${publicAssets.length} 张登录插画。`)
}

await syncIllustrations()
