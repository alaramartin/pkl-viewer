const vscode = acquireVsCodeApi(); 

document.addEventListener("DOMContentLoaded", function() {
    document.addEventListener("click", function(e) {
        // check if the "load more" button was clicked
        if (e.target.classList.contains("load-more")) {
            console.log("clicked");
            vscode.postMessage({
                command: "load more"
            });
            // remove the button
            e.target.style.display = this.none;
            // todo: loading animation until loading complete? will have to send a message back from extension to webview
        }
    });
});