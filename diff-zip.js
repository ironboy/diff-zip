const fs = require('fs')
const path = require('path')
const rimraf = require('rimraf')
const {ncp} = require('ncp')
const unzip = require('unzip-stream')
const archiver = require('archiver')
const {exec} = require('child_process')

module.exports = class DiffZip {
  // workingDir - where to check out and work with the repo diffs
  // repoPath - path to repo (ssh)
  // zipPath -  path for zip/diff
  // commitHashFrom - a hash for what to change from
  // commitHashTo - a hash for what to change to (leave blank for HEAD)
  // _exec array of commands to execute in both folders (defaults to npm install --production)
  // removeWorkingDirWhenDone - defaults to true
  // (so don't put your zipPath to inside the workingDir)
  // debug (defaults to false)
  static repoDiff (
    workingDir,
    repoPath,
    zipPath,
    commitHashFrom,
    commitHashTo = 'head',
    _exec = ['npm install --production'],
    removeWorkingDirWhenDone = true,
    debug = false
  ) {
    this.lastLogTime = 0
    let l = debug ? this.log : () => 1
    return new Promise((resolve, reject) => {
      l('Removing workingDir if it exists', workingDir)
      rimraf(workingDir, (err) => {
        if (err) { reject(err); return }
        l('Creating empty workingDir', workingDir)
        fs.mkdirSync(workingDir)
        l('Cloning repo into workingDir', repoPath)
        exec(`git clone ${repoPath}`, {cwd: workingDir}, (err, stdOut) => {
          if (err) { reject(err); return }
          let folderA = path.join(workingDir, (fs.readdirSync(workingDir))[0])
          let folderB = folderA + '_b'
          l('Repo cloned to', folderA)
          l('Copying cloned repo to', folderB)
          ncp(folderA, folderB, (err) => {
            if (err) { reject(err); return }
            l('Checking out ', commitHashFrom, ' to folder ', folderA)
            exec(`git checkout ${commitHashFrom}`, {cwd: folderA}, (err, stdOut) => {
              if (err) { reject(err); return }
              l('Checking out ', commitHashFrom, ' to folder ', folderB)
              exec(`git checkout ${commitHashTo}`, {cwd: folderB}, (err, stdOut) => {
                if (err) { reject(err); return }
                let co = 0
                while (_exec.length) {
                  co += 2
                  let e = _exec.shift()
                  l('Executing ', e, ' in folder ', folderA)
                  exec(e, {cwd: folderA}, (err) => {
                    if (err) { reject(err); return }
                    co--
                    if (co === 0) { go(zipPath, folderA, folderB) }
                  })
                  l('Executing ', e, ' in folder ', folderB)
                  exec(e, {cwd: folderB}, (err) => {
                    if (err) { reject(err); return }
                    co--
                    if (co === 0) { go(zipPath, folderA, folderB) }
                  })
                }
              })
            })
          })
        })
        let go = async (zipPath, folderA, folderB) => {
          let err
          let m = await this.create(zipPath, folderA, folderB, debug, true).catch((e) => { err = e })
          if (err) { reject(err); return }
          if (removeWorkingDirWhenDone) {
            l('Removing workingDir', workingDir)
            rimraf(workingDir, (err) => {
              if (err) { reject(err) }
              l('Zip creation from repo done')
              resolve(m)
            })
          } else {
            l('Zip creation from repo done')
            resolve(m)
          }
        }
      })
    })
  }

  // zip = path to zip to create (a diff between the folders)
  // folderA = path to folderA (old state), set to null/falsey for "blank" old state
  // folderB = path to folderB (new state)
  static create (zip, folderA, folderB, debug = false, calledFromRepoDiff = false) {
    this.lastLogTime = calledFromRepoDiff ? this.lastLogTime : 0
    let l = debug ? this.log : () => 1
    return new Promise((resolve, reject) => {
      if (!folderA) {
        this.createFromBlank(resolve, reject, folderB, zip, debug)
        return
      }

      let trim = (x) => x.substr(-1) === '/' ? x.substr(0, x.length - 1) : x
      folderA = trim(folderA)
      folderB = trim(folderB)
      zip = zip.split('.zip')[0]

      l('running diff -rq on', folderA, folderB)
      exec(`diff -rq "${folderA}" "${folderB}"`, (err, stdout) => {
        if (err) {}
        let arrs = {add: [], change: [], remove: []}
        let r = stdout.split('\n')
        let add = new RegExp(`^Only in ${folderB}[:\\/]`)
        let remove = new RegExp(`^Only in ${folderA}[:\\/]`)
        let change = / differ$/
        let ignore = [
          /.DS_Store$/,
          /.DS_Store differ$/
        ]
        for (let f of r) {
          let ignoreIt = false
          for (let i of ignore) {
            ignoreIt = ignoreIt || i.test(f)
          }
          if (ignoreIt) { continue } else if (add.test(f)) {
            arrs.add.push('add:' + f.replace(add, '').replace(/: /g, '/').trimLeft())
          } else if (change.test(f)) {
            arrs.change.push('change:' + f.split(folderB)[1].replace(change, '').trimLeft())
          } else if (remove.test(f)) {
            arrs.remove.push('remove:' + f.replace(remove, '').replace(/: /g, '/').trimLeft())
          }
        }
        let all = arrs.add.concat(arrs.change, arrs.remove)
        l('Calculated', all.length, 'differences')
        let tempFolder = zip + '_temp' + (Math.random() + '').split('.')[1]
        l('Creating temporary folder', tempFolder)
        fs.mkdirSync(tempFolder)
        let co = 0
        l('Copying differences (add + change)')
        for (let i = 0; i < all.length; i++) {
          let file = all[i]
          if (file.indexOf('remove:') !== 0) {
            co++
            ncp(
              path.join(folderB, file.split(':')[1]),
              path.join(tempFolder, i + ''),
              (err) => {
                if (err) {
                  reject(err)
                  return
                }
                co--
                if (co === 0) {
                  l('Writing manifest file')
                  fs.writeFileSync(
                    path.join(tempFolder, 'manifest.json'),
                    JSON.stringify(all, '', '  '),
                    'utf-8'
                  )
                  l('Zipping differences', zip + '.zip')
                  this.zipFolder(zip + '.zip', tempFolder).catch((err) => reject(err)).then(() => {
                    l('Removing temporary folder', tempFolder)
                    rimraf(tempFolder, (err) => {
                      if (err) {
                        reject(err)
                        return
                      }
                      l('Zip creation done')
                      resolve(all)
                    })
                  })
                }
              }
            )
          }
        }
      })
    })
  }

  // helper method for create
  static createFromBlank (resolve, reject, folderB, zip, debug = false) {
    let l = debug ? this.log : () => 1
    let tempFolder = zip + '_temp' + (Math.random() + '').split('.')[1]
    let subTemp = path.join(tempFolder, 'all')
    l('Strategy: "Zip creation from blank"')
    l('Creating temporary folder', tempFolder)
    fs.mkdirSync(tempFolder)
    let manifestPath = path.join(tempFolder, 'manifest.json')
    l('Writing maninefest file')
    fs.writeFileSync(manifestPath, '["create:::all"]')
    fs.renameSync(folderB, subTemp)
    l('Zipping differences', zip + '.zip')
    this.zipFolder(zip + '.zip', tempFolder).catch((err) => reject(err)).then(() => {
      fs.renameSync(subTemp, folderB)
      l('Removing temporary folder', tempFolder)
      rimraf(tempFolder, (err) => {
        if (err) {
          reject(err)
          return
        }
        l('Zip creation done')
        resolve(['create:::all'])
      })
    })
  }

  // zip = path to zip/diff to apply (a diff between the folders)
  // folder = path to folder to which we want to apply the diff to
  // folderCopy (optional path) - don't apply the diff directly to folder,
  // instead copy the folder to this destination and apply th diff here
  static apply (zip, folder, folderCopy, debug = false) {
    this.lastLogTime = 0
    let l = debug ? this.log : () => 1
    return new Promise((resolve, reject) => {
      zip += zip.includes('.zip') ? '' : '.zip'

      // if folderCopy is provided do not apply on original folder
      if (folderCopy) {
        l('Copying folder', folder, 'to', folderCopy)
        ncp(folder, folderCopy, (err) => {
          if (err) {
            reject(err)
            return
          }
          folder = folderCopy
          go(this)
        })
      } else {
        go(this)
      }

      function go (that) {
        let tempFolder = folder + '_temp' + (Math.random() + '').split('.')[1]
        l('Unzipping ', zip, 'to temporary folder', tempFolder)
        fs.createReadStream(zip)
          .pipe(unzip.Extract({ path: tempFolder }))
          .on('close', (err) => {
            if (err) {
              reject(err)
              return
            }
            let innerFolder = path.join(tempFolder, (fs.readdirSync(tempFolder))[0])
            l('Reading manifest file')
            let manifest = require(path.join(innerFolder, 'manifest.json'))
            if (manifest && manifest[0] === 'create:::all') {
              that.applyFromBlank(resolve, reject, zip, folder, tempFolder, innerFolder, debug)
              return
            }
            let co = manifest.length
            l('Applying changes to', folder)
            for (let i = 0; i < manifest.length; i++) {
              let file = manifest[i]
              if (file.indexOf('remove:') !== 0) {
                ncp(
                  path.join(innerFolder, i + ''),
                  path.join(folder, file.split(':', 2)[1]),
                  (err) => {
                    if (err) {
                      reject(err)
                      return
                    }
                    co--
                    co === 0 && rimraf(tempFolder, (err) => {
                      if (err) {
                        reject(err)
                        return
                      }
                      l('Removed temporary folder', tempFolder)
                      l('Done applying diffs to', folder)
                      resolve(manifest)
                    })
                  }
                )
              } else {
                rimraf(path.join(folder, file.split(':', 2)[1]), (err) => {
                  if (err) {
                    reject(err)
                    return
                  }
                  co--
                  co === 0 && rimraf(tempFolder, (err) => {
                    if (err) {
                      reject(err)
                      return
                    }
                    l('Removed temporary folder', tempFolder)
                    l('Done applying diffs to', folder)
                    resolve(manifest)
                  })
                })
              }
            }
          })
      }
    })
  }

  // helper method for apply
  static applyFromBlank (resolve, reject, zip, folder, tempFolder, innerFolder, debug) {
    let l = debug ? this.log : () => 1
    l('Strategy: "Zip apply from blank"')
    let allFolder = path.join(innerFolder, 'all')
    l('Removing folder', folder)
    rimraf(folder, (err) => {
      if (err) {
        reject(err)
        return
      }
      l('Moving unzipped content from', allFolder, 'to', folder)
      fs.renameSync(allFolder, folder)
      l('Removing temporry folder', tempFolder)
      rimraf(tempFolder, (err) => {
        if (err) {
          reject(err)
          return
        }
        l('Done applying diffs to folder', folder)
        resolve('["create:::all"]')
      })
    })
  }

  // helper method for zipping
  static zipFolder (zipPath, folderPath, folderNameInZip) {
    return new Promise((resolve, reject) => {
      folderNameInZip = folderNameInZip || folderPath.split(path.sep).pop()
      let output = fs.createWriteStream(zipPath)
      let archive = archiver('zip')
      archive.on('error', (err) => {
        reject(err)
      })
      output.on('close', (err) => {
        if (err) {
          reject(err)
        }
        resolve('done')
      })
      archive.pipe(output)
      archive.directory(folderPath, folderNameInZip)
      archive.finalize()
    })
  }

  // Debug log
  static log (...args) {
    let line
    try { throw (new Error()) } catch (e) {
      line = e.stack.split('diff-zip.js:')[2].split(')')[0]
    }
    if (DiffZip.lastLogTime) {
      let ms = Date.now() - DiffZip.lastLogTime
      console.log(DiffZip.timeTakenIndent + 'Time taken:', ms, 'ms')
    }
    DiffZip.lastLogTime = Date.now()
    DiffZip.timeTakenIndent = ''.padEnd(line.length + 1)
    console.log(line, ...args)
  }
}
