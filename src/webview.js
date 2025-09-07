const vscode = acquireVsCodeApi(); 

document.addEventListener("DOMContentLoaded", function() {
    document.addEventListener("click", function(e) {
        // check if a relevant button was clicked
        if (e.target.classList.contains("load-more") || e.target.classList.contains("re-revert")) {
            vscode.postMessage({
                command: "load more"
            });
            // start the loading animation
            const loadingAnimation = document.querySelector(".loader");
            loadingAnimation.style.visibility = "visible";
            const content = document.getElementsByTagName("pre")[0];
            content.style.visibility = "hidden";
        } else if (e.target.classList.contains("revert")) {
            vscode.postMessage({
                command: "revert"
            });
        }
    });

    // listen for messages from the extension
    window.addEventListener("message", function(e) {
        const data = e.data;
        const command = data && data.command ? data.command : data;
        // if the loading worked, remove the button currently visible and replace it with a new one
        if (command === "success") {
            // show the new content
            const contentViewer = this.document.getElementsByTagName("pre")[0];
            contentViewer.innerHTML = data.setContent;
            hideAllButtons();
            // stop the loading animation
            const loadingAnimation = document.querySelector(".loader");
            loadingAnimation.style.visibility = "hidden";
            const content = document.getElementsByTagName("pre")[0];
            content.style.visibility = "visible";
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