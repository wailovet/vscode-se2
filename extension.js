// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
const axios = require("axios");
const fs = require("fs");
const fpath = require("path");

async function getWorkspaceFolder() {
  let data = vscode.workspace.workspaceFolders;
  if (data.length == 1) {
    return data[0].uri.fsPath;
  }
  
  let cur_file = vscode.window.activeTextEditor.document.fileName 
  
  for (let index = 0; index < data.length; index++) {
    const element = data[index];
    if(cur_file.indexOf(element.uri.fsPath) != -1){
      return element.uri.fsPath;
    }
  }

  let name = [];
  for (let index = 0; index < data.length; index++) {
    const element = data[index];
    name.push(element.uri.fsPath);
  }
  return await vscode.window.showQuickPick(name);
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */

let bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
let se2console = vscode.window.createOutputChannel("vscode-se2-debug");
se2console.log = function () {
  let msg = "";
  for (let index = 0; index < arguments.length; index++) {
    const element = arguments[index];
    msg += element;
  }
  se2console.appendLine(msg);
};
function activate(context) {
  vscode.window.showInformationMessage("vscode-se activate");

  //注册主核心功能
  registerCoreCommand(context);
}
exports.activate = activate;

// this method is called when your extension is deactivated
function deactivate() {}

/**
 * @param {vscode.ExtensionContext} context
 */
function registerCoreCommand(context) {
  vscode.workspace.onDidSaveTextDocument(async (e) => {
    // 文件发生更新
    let filePath = e.fileName;
    // 判断后缀
    if (filePath.indexOf(".se2.js") == -1) {
      return;
    }
    se2console.log("onDidChange:", JSON.stringify(e));
    se2console.log("onDidChange filePath:", filePath);

    let cur_script = await Service.getCurrentEditScript(context, filePath);
    if (cur_script) {
      Service.saveCurrentScript(context, filePath);
      vscode.window
        .showInformationMessage(
          `已保存到配置,是否删除临时文件\n${filePath}`,
          "确认",
          "取消"
        )
        .then((data) => {
          if (data === "确认") {
            fs.unlinkSync(filePath);
          }
        });
    }

    let scripts = await Service.getCurrentEditScriptConfig(context, filePath);
    if (scripts) {
      Service.saveScriptConfig(context, scripts);
      vscode.window
        .showInformationMessage(
          `已保存到配置,是否删除临时文件\n${filePath}`,
          "确认",
          "取消"
        )
        .then((data) => {
          if (data === "确认") {
            fs.unlinkSync(filePath);
          }
        });
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.vscode-se2-manage",
      async function () {
        try {
          let scripts = await Service.getScriptConfig(context);
          Service.scriptsManageMenu(context, scripts);
        } catch (error) {
          se2console.log(`
=================== manage script error ===================
message: ${error.message}
stack: ${error.stack}
fileName: ${error.fileName}
lineNumber: ${error.lineNumber}
name: ${error.name}
              `);
        }
      }
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.vscode-se2-cmd",
      async function () {
        let scripts = await Service.getScriptConfig(context);
        Service.config(context, scripts, bar, function (data) {
          console.log("select:", data);

          if (data && data["run_script"] && data["run_script"] != "") {
            try {
              eval(`(async function(){\n${data["run_script"]}\n})()`);
            } catch (error) {
              se2console.log(`
=================== run_script:${data["label"]} eval error ===================
message: ${error.message}
stack: ${error.stack}
fileName: ${error.fileName}
lineNumber: ${error.lineNumber}
name: ${error.name}
              `);
            }
          }
        });
      }
    )
  );
}

module.exports = {
  activate,
  deactivate,
};

var Service = {
  async config(context, scripts, bar, cb) {
    vscode.window.showQuickPick(scripts).then((data) => {
      if (data) {
        cb(data);
      }
    });
  },
  async editScript(context, title, content) {
    let pro_dir = await getWorkspaceFolder();
    let vscode_dir = fpath.join(pro_dir, ".vscode");
    if (!fs.existsSync(vscode_dir)) {
      fs.mkdirSync(vscode_dir);
    }
    //修改脚本
    let tmp_path = fpath.join(vscode_dir, `${title}.se2.js`);
    fs.writeFileSync(tmp_path, content);
    vscode.workspace
      .openTextDocument(tmp_path)
      .then((document) => vscode.window.showTextDocument(document, {}));
  },
  async getCurrentEditScript(context, filePath) {
    let fileContent = vscode.window.activeTextEditor.document.getText();
    if (filePath && filePath != "") {
      fileContent = fs.readFileSync(filePath, "utf-8");
    }else{
      filePath = vscode.window.activeTextEditor.document.fileName;
    }

    if (filePath.indexOf(".se2.js") == -1) {
      return undefined;
    }

    // ==SE2UserScript==
    // @name 脚本名称
    // @description 脚本描述
    // ==/SE2UserScript==
    // 开始解析文件内容

    let name = "";
    let description = "";
    let arr = fileContent.split("\n");
    let status = 0;
    for (let index = 0; index < arr.length; index++) {
      let element = arr[index];
      // 去除所有空格
      element = element.replace(/\s*/g, "");
      if (element.indexOf("//==SE2UserScript==") != -1) {
        status = 1;
        continue;
      }
      if (status == 1 && element.indexOf("//==/SE2UserScript==") != -1) {
        status = 2;
        break;
      }
      if (status == 1) {
        if (element.indexOf("@name") != -1) {
          name = element.split("@name")[1].trim();
        }
        if (element.indexOf("@description") != -1) {
          description = element.split("@description")[1].trim();
        }
      }
    }
    if (status != 2 || !name || name == "") {
      return undefined;
    }
    return {
      label: name,
      description: description,
      run_script: fileContent,
    };
  },
  async saveCurrentScript(context, filePath) {
    let cur_script = await Service.getCurrentEditScript(context, filePath);
    if (!cur_script) {
      vscode.window.showInformationMessage("当前文件不是se2脚本文件");
      return;
    }
    let scripts = await Service.getScriptConfig(context);
    let is_exist = false;
    for (let index = 0; index < scripts.length; index++) {
      const element = scripts[index];
      if (element["label"] == cur_script["label"]) {
        scripts[index]["label"] = cur_script["label"];
        scripts[index]["description"] = cur_script["description"];
        scripts[index]["run_script"] = cur_script["run_script"];
        Service.saveScriptConfig(context, scripts);
        is_exist = true;
        break;
      }
    }
    if (!is_exist) {
      cur_script["id"] = scripts.length + 1;
      scripts.push(cur_script);
      Service.saveScriptConfig(context, scripts);
    }
    se2console.log(scripts);
    vscode.window.showInformationMessage("保存成功");
  },
  async createdScript(context) {
    let pro_dir = await getWorkspaceFolder();
    let vscode_dir = fpath.join(pro_dir, ".vscode");
    if (!fs.existsSync(vscode_dir)) {
      fs.mkdirSync(vscode_dir);
    }
    let tmp_path = fpath.join(vscode_dir, "news.se2.js");
    //新增脚本
    fs.writeFileSync(
      tmp_path,
      `// ==SE2UserScript==
// @name 脚本名称
// @description 脚本描述
// ==/SE2UserScript==
// 提示信息
// se2console.log("hello world") // 打日志
// vscode.window.showInformationMessage("hello world") //信息提示
// vscode.window.showQuickPick([{label:"选择1"},{label:"选择2"}]).then((data) => { se2console.log(data); }); // 选择框
// vscode.window.showInputBox({placeHolder:"请输入内容"}).then((data) => { se2console.log(data); }); // 输入框
// vscode.window.showOpenDialog({canSelectFiles:true,canSelectFolders:false,canSelectMany:false}).then((data) => { se2console.log(data); }); // 打开文件
// vscode.window.showInformationMessage("hello world", "确认", "取消").then((data) => { se2console.log(data); }); // 确认框
// vscode.window.showErrorMessage("hello world") // 错误提示
//
// 执行外部命令
// const { execSync } = require("child_process"); var result = execSync("本地命令行") //无回显
// var t = vscode.window.createTerminal("自定义窗口名称", "cmd.exe", ["/c", "本地命令行"]); t.show() //有回显
// 
// 执行vscode命令
// vscode.commands.executeCommand('vscode commands');  
//
// 编辑器操作
// vscode.window.activeTextEditor.edit(function (textEditorEdit) { textEditorEdit.insert(vscode.window.activeTextEditor.selection.active,"// 光标处插入内容") });
// let fileName = vscode.window.activeTextEditor.document.fileName // 当前文件名
// vscode.workspace.openTextDocument("文件名").then(document => vscode.window.showTextDocument(document, {})) // 打开文件
// vscode.window.activeTextEditor.document.getText() // 获取当前文件内容
// vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection) // 获取当前选中内容
// vscode.window.activeTextEditor.document.lineAt(vscode.window.activeTextEditor.selection.active.line).text // 获取当前行内容
// await getWorkspaceFolder() // 获取当前工作区目录
// 
// 配置操作
// vscode.workspace.getConfiguration().get("vscode-se2.config") // 获取配置
// vscode.workspace.getConfiguration().update("vscode-se2.config", "配置内容", true) // 更新配置`
    );
    vscode.workspace
      .openTextDocument(tmp_path)
      .then((document) => vscode.window.showTextDocument(document, {}));
  },
  async scriptsManageMenu(context, scripts) {
    for (let index = 0; index < scripts.length; index++) {
      scripts[index]["title"] = scripts[index]["label"];
      scripts[index]["label"] = `修改 >> ${scripts[index]["label"]}`;
    }

    scripts.push({
      id: -3,
      label: ">> 编辑原始配置",
    });
    scripts.unshift({
      id: -2,
      label: ">> 新建脚本",
    });
    let cur_script = await Service.getCurrentEditScript(context);
    if (cur_script) {
      scripts.unshift({
        id: -1,
        label: `>> 保存当前脚本[${cur_script["label"]}]到配置文件`,
      });
    }
    vscode.window.showQuickPick(scripts).then((data) => {
      // 获取当前项目目录

      switch (data["id"]) {
        case -3:
          Service.editScriptConfig(context);
          break;
        case -2:
          Service.createdScript(context);
          break;
        case -1:
          Service.saveCurrentScript(context);
          break;
        default:
          Service.editScript(context, data["title"], data["run_script"]);
      }
    });
  },
  async saveScriptConfig(context, scripts) {
    vscode.workspace
      .getConfiguration()
      .update("vscode-se2.script", scripts, true);
  },
  async getScriptConfig(context) {
    let script = vscode.workspace.getConfiguration().get("vscode-se2.script");
    return script;
  },
  async getCurrentEditScriptConfig(context, filePath) {
    let fileContent = vscode.window.activeTextEditor.document.getText();
    if (filePath) {
      fileContent = fs.readFileSync(filePath, "utf-8");
    }

    let arr = fileContent.split("\n");
    let status = 0;
    for (let index = 0; index < arr.length; index++) {
      let element = arr[index];
      // 去除所有空格
      element = element.replace(/\s*/g, "");
      if (element.indexOf("//==SE2Scripts==") != -1) {
        status = 1;
        break;
      }
    }
    if (status != 1) {
      return null;
    }
    fileContent = fileContent.split("//==SE2Scripts==")[1];
    try {
      fileContent = JSON.parse(fileContent);
      return fileContent;
    } catch (error) {
      return null;
    }
  },
  async editScriptConfig(context) {
    let scripts = await Service.getScriptConfig(context);
    let pro_dir = await getWorkspaceFolder();
    let vscode_dir = fpath.join(pro_dir, ".vscode");
    if (!fs.existsSync(vscode_dir)) {
      fs.mkdirSync(vscode_dir);
    }
    let tmp_path = fpath.join(vscode_dir, "vscode-se2-script.se2.js");

    fs.writeFileSync(
      tmp_path,
      `//==SE2Scripts==\n` + JSON.stringify(scripts, null, 4)
    );
    vscode.workspace
      .openTextDocument(tmp_path)
      .then((document) => vscode.window.showTextDocument(document, {}));
  },
};
