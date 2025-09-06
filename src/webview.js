const vscode = acquireVsCodeApi(); 

document.addEventListener("DOMContentLoaded", function() {
    document.addEventListener("click", function(e) {
        // check if the "load more" button was clicked
        if (e.target.classList.contains("load-more")) {
            console.log("clicked");
            vscode.postMessage({
                command: "load more"
            });
        }
    });

    // todo: loading animation until loading complete? will have to send a message back from extension to webview
    window.addEventListener("message", function(e) {
        const command = e.data.command;
        console.log("received");
        // if page update successful, remove the button
        // todo: replace load button with revert button?
        if (command === "success") {
            const loadButton = document.querySelector(".load-more");
            if (loadButton) {
                loadButton.style.display = "none";
                console.log("removed");
            }
        }
    });
});