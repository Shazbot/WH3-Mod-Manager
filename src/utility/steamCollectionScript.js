export default `
/* eslint-disable no-undef */
setTimeout(function () {
  // Create "Add" button
  var btn_add = document.createElement("BUTTON");
  var collection_window = document.querySelector("div.collectionAddItemsSection");
  collection_window.insertBefore(btn_add, collection_window.firstChild);
  btn_add.setAttribute("id", "ASCM_addall");
  jQuery("button#ASCM_addall").html("+");
  btn_add.style.position = "absolute";
  btn_add.style.top = "110px";
  btn_add.style.right = "50px";
  btn_add.style["border-radius"] = "10px";
  btn_add.style.color = "white";
  btn_add.style["font-size"] = "40px";
  btn_add.style.background = "#00c417";
  btn_add.style.width = "60px";
  btn_add.style.height = "60px";
  btn_add.style["text-decoration"] = "none";
  // Create "Remove" button
  var btn_rem = document.createElement("BUTTON");
  collection_window.insertBefore(btn_rem, collection_window.firstChild);
  btn_rem.setAttribute("id", "ASCM_removeall");
  jQuery("button#ASCM_removeall").html("-");
  btn_rem.style.position = "absolute";
  btn_rem.style.top = "110px";
  btn_rem.style.right = "120px";
  btn_rem.style["border-radius"] = "10px";
  btn_rem.style.color = "white";
  btn_rem.style["font-size"] = "40px";
  btn_rem.style.background = "#c20000";
  btn_rem.style.width = "60px";
  btn_rem.style.height = "60px";
  btn_rem.style["text-decoration"] = "none";
  // Bind "Add" button
  jQuery("button#ASCM_addall").click(function () {
    var collection_name = jQuery("div.manageCollectionHeader div.breadcrumbs a").eq(2).text().trim();
    var url = new URL(document.location.href);
    var collection_id = url.searchParams.get("id");
    var queries = [];
    var workshopIds = [];
    for (const workshopId of workshopIds) {
      jQuery("div#MySubscribedItems #choice_MySubscribedItems_" + workshopId + ":not(.inCollection)").each(
        function () {
          var data = {
            id: collection_id,
            sessionid: window.g_sessionID,
            childid: jQuery(this).attr("id").replace("choice_MySubscribedItems_", ""),
            activeSection: collection_name,
          };
          console.log("ADDING TO COLLECTION:", workshopId);
          queries.push(addToCollection(data, jQuery(this)));
        }
      );
    }
    jQuery(".manageCollectionItemsBody").prepend(
      '<p style="cursor:wait" class="itemChoice">Adding mods to the collection, please wait... The page will auto-refresh once all mods are added.</p>'
    );
    jQuery.when(...queries).done(function () {
      console.log("DONE ADDING TO COLLECTION");
      document.location.reload();
    });
  });
  // Bind "Remove" button
  jQuery("button#ASCM_removeall").click(function () {
    jQuery("div#MySubscribedItems div.itemChoice.inCollection").each(function () {
      window.RemoveChildFromCollection(jQuery(this).attr("id").replace("choice_MySubscribedItems_", ""));
    });
  });
  // Function to send a request to add item to a collection
  function addToCollection(data) {
    return jQuery.ajax({
      type: "POST",
      url: "https://steamcommunity.com/sharedfiles/addchild",
      data: data,
    });
  }
}, 0);
`;
