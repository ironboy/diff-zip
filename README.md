# dif-zipp

This module creates and applies differences/patches between two folders.

## Raison d'etre
Although the module can't create diffs cross-platform, yet (Windows support is missing, see below) it can apply them cross-platform.

This means that this is a useful tool when building update-patches for desktop applications (think Electron, NW) etc. Because: 
* The end user does not have to have git (or even an unzipper) installed.
* Diffs/patches can be easily downloaded and applied in a "user data" - folder, omitting the need to rebuild a binary on updates.

## Inner workings 

The module works by

* Creating diffs

  1) Identifying the differences using the Linux/Mac command "diff". (So it won't work on Windows. We might fix Windows-compatability in the future by using the FC command.)
  2) Analyzing the output of the diff, thus sorting files and folders into three categories (add, change and remove).
  3) Creating a manifest file with the differences.
  4) Zipping the manifest file together with the files/folders that are additions and changes.

* Applying diffs

  1) Unzipping a "diff-zip".
  2) Reading the manifest file.
  3) Applying the changes to a folder.

## Installation

```
npm install diff-zip
```

Then, in your program, require diff-zip:

```javascript
const DiffZip = require('DiffZip')
```


## Creating diffs
Choose any two folders or two different commits in a git repository.

If you choose a git repository you can run any commands (build scripts etc) on the folders before creating a diff.

### Diffing between two folders

```javascript
await DiffZip.create (
  'path to zip file to be created',
  
  'path to folder A (initial state)',
   // null: for empty initial state
  
  'path to folderB (final state)',
  
  // OPTIONAL
  
  true 
  // for verbose logging
  // default: false
)
```

### Diffing between two commits in a git repository

```javascript
await DiffZip.repoDiff (
  'path to temporary working dir',
  
  'path to git repo (ssh path)',

  'path to zip file to be created',
  
  'commitHash for initial state',
  
  // OPTIONAL
  
  'commitHash for final state',
  // default: head
  
  ['command1', 'command2' etc]
  // commands to apply on both folders
  // default: ['npm install --production']
  
  true,
  // remove temporary folder when done
  // default: true

  true 
  // for verbose logging
  // default: false
)
```

## Applying diffs
Choose a folder to apply the diff to and decide if you want to apply it directly to the folder or to a copy of the folder.

``` javascript
await DiffZip.apply(
  'path to zip file to apply as diff',

  'path to folder to apply the diff to',

  // OPTIONAL

  'path to copy of folder to be created',
  // set this if you want the diff to be applied
  // to a copy of the folder instead of to the original folder

  true 
  // for verbose logging
  // default: false
)
```
