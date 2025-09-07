const vscode = acquireVsCodeApi(); 

document.addEventListener("DOMContentLoaded", function() {
    document.addEventListener("click", function(e) {
        // check if a relevant button was clicked
        if (e.target.classList.contains("load-more")) {
            vscode.postMessage({
                command: "load more"
            });
        } else if (e.target.classList.contains("revert")) {
            vscode.postMessage({
                command: "revert"
            });
        } else if (e.target.classList.contains("re-revert")) {
            vscode.postMessage({
                command: "load more"
            });
        }
    });

    // listen for messages from the extension
    window.addEventListener("message", function(e) {
        const data = e.data;
        const command = data && data.command ? data.command : data;
        // if the loading worked, remove the button currently visible and replace it with a new one
        if (command === "success") {
            hideAllButtons();
            if (data.newButton) {
                const newBtn = document.querySelector(data.newButton);
                if (newBtn) {
                    newBtn.style.display = "inline-block";
                }
            }
        }
    });

    // on load, only show the load-more button
    function setInitialButtonState() {
        hideAllButtons();
        const loadMore = document.querySelector('.load-more');
        if (loadMore) { loadMore.style.display = "inline-block"; }
    }
    setInitialButtonState();
    
    // hide all action buttons
    function hideAllButtons() {
        const btns = document.querySelectorAll('.load-more, .revert, .re-revert');
        btns.forEach(btn => btn.style.display = 'none');
    }
});