const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const yaml = require('js-yaml')
const semver = require('semver')

function requireCondition(condition, message){
    if(!condition){
        throw new Error(message)
    }
}

function readYaml(file){
    const result = yaml.load(fs.readFileSync(file, 'utf8'))
    requireCondition(result != null && typeof result === 'object' && !Array.isArray(result), `Invalid YAML object: ${file}`)
    return result
}

function fileSize(file){
    const stat = fs.statSync(file)
    requireCondition(stat.isFile() && stat.size > 0, `Expected a nonempty file: ${file}`)
    return stat.size
}

function sha512(file){
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha512')
        const stream = fs.createReadStream(file)
        stream.on('data', chunk => hash.update(chunk))
        stream.on('error', reject)
        stream.on('end', () => resolve(hash.digest('base64')))
    })
}

async function validateRelease(directory = 'dist'){
    const releaseDirectory = path.resolve(directory)
    const manifest = readYaml(path.join(releaseDirectory, 'latest.yml'))
    requireCondition(typeof manifest.version === 'string' && semver.valid(manifest.version) === manifest.version, 'latest.yml must contain a valid version without a v prefix.')
    requireCondition(Array.isArray(manifest.files) && manifest.files.length === 1, 'latest.yml must describe exactly one Windows NSIS installer.')

    const installer = manifest.files[0]
    requireCondition(installer != null && typeof installer === 'object', 'latest.yml files[0] must describe the installer.')
    const expectedName = `ShinobiCraft2.Launcher-setup-${manifest.version}.exe`
    requireCondition(/^[A-Za-z0-9._-]+$/.test(expectedName), 'The version produces an unsafe GitHub asset name.')
    requireCondition(installer.url === expectedName, `latest.yml files[0].url must exactly match the upload name: ${expectedName}`)
    requireCondition(manifest.path === expectedName, `latest.yml path must exactly match files[0].url: ${expectedName}`)
    requireCondition(Number.isSafeInteger(installer.size) && installer.size > 0, 'latest.yml files[0].size must be a positive integer.')
    requireCondition(typeof installer.sha512 === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(installer.sha512), 'latest.yml files[0].sha512 must be a SHA512 digest encoded as base64.')
    requireCondition(manifest.sha512 === installer.sha512, 'latest.yml sha512 must match files[0].sha512.')

    const installerPath = path.join(releaseDirectory, expectedName)
    const blockmapName = `${expectedName}.blockmap`
    const blockmapPath = path.join(releaseDirectory, blockmapName)
    const actualSize = fileSize(installerPath)
    requireCondition(actualSize === installer.size, `Installer size mismatch: metadata=${installer.size}, file=${actualSize}.`)
    fileSize(blockmapPath)
    requireCondition(await sha512(installerPath) === installer.sha512, 'Installer SHA512 mismatch: the installer differs from latest.yml.')

    const unpackedDirectory = path.join(releaseDirectory, 'win-unpacked')
    const checkedPackagedConfig = fs.existsSync(unpackedDirectory)
    if(checkedPackagedConfig){
        const config = readYaml(path.join(unpackedDirectory, 'resources', 'app-update.yml'))
        requireCondition(config.provider === 'github', 'Packaged app-update.yml provider must be github.')
        requireCondition(config.owner === 'CaracatoP' && config.repo === 'ShinobiCraft2', 'Packaged app-update.yml must point to CaracatoP/ShinobiCraft2.')
        requireCondition(config.updaterCacheDirName === 'shinobicraft2-launcher-updater', 'Packaged app-update.yml updaterCacheDirName must be shinobicraft2-launcher-updater.')
    }

    return {
        version: manifest.version,
        directory: releaseDirectory,
        files: ['latest.yml', expectedName, blockmapName],
        checkedPackagedConfig
    }
}

if(require.main === module){
    const run = async () => {
        requireCondition(process.argv.length <= 3, 'Usage: node scripts/validate-update-release.js [dist-directory]')
        const result = await validateRelease(process.argv[2])
        console.log(`[Release] validated v${result.version}: size, SHA512, asset names and blockmap.`)
        if(result.checkedPackagedConfig){
            console.log('[Release] packaged GitHub provider and updater cache directory validated.')
        } else {
            console.log('[Release] win-unpacked absent; packaged app-update.yml was not checked.')
        }
        console.log('[Release] Upload these files using these exact names:')
        for(const file of result.files){
            console.log(`  ${file}`)
        }
    }
    run().catch(error => {
        console.error(`[Release] validation failed: ${error.message}`)
        process.exitCode = 1
    })
}

module.exports = { validateRelease }
