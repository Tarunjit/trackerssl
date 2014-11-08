var wr = chrome.webRequest;

var parseResponse = function(response){
  console.log("reponse", response);
}

var urlCount = 0;

/****
Dependency = URI.js
****/
var TrackerSSL_URI = function(uriObject){
  this.uri = uriObject
  console.log(this);
}

// url
//   type
//     visited_url
//       associated_trackers
//       associated_keywords
//       // associated_identities
//     tracker_url
//       associated_domains
//   https_info
//     supports_ssl
//     ssl_version
//     host_certificate
//     intermediate_authority
//     certificate_authority
  

// tracker_identifier
//   ghostery_interface

// https_analyzer
//   https_everywhere_interface

// keyword_analyzer
//   ruleset

// // identity_analyzer
// //   ruleset

// cert_checker
//   ruleset

// surveillance_comparer
//   ruleset

var TrackerSSL_Request = Backbone.Model.extend({
  initialize: function(){
    this.set('requests', new TrackerSSL_RequestCollection());
  },
  thirdPartyChecker: function(firstPartyHostName){
    // console.log(this.get('hostname'), firstPartyHostName);

    // Naive; doesn't take into account subdomains
    if(this.get('hostname') !== firstPartyHostName){
      this.set('isThirdParty', true);
    }
    else{
      this.set('isThirdParty', false);
    }
  }
});

var TrackerSSL_RequestCollection = Backbone.Collection.extend({
      model: TrackerSSL_Request,
      comparator: function( collection ){
        return( collection.get( 'httpsing' ) );
      }
});

var TrackerSSL_Tab = Backbone.Model.extend({
  tabid: null,
  idAttribute: "tabid",
  initialize: function(){
    this.set('url', new TrackerSSL_Request());
    console.log("new first party url loaded");
  },
  reset: function(){
    this.set('url', new TrackerSSL_Request());
  },
  updateIconCounter: function(txt){
    chrome.browserAction.setBadgeText({
      text: String(txt), 
      tabId: this.get('tabid')
    });
  }
});

var TrackerSSL_TabCollection = Backbone.Collection.extend({
  model: TrackerSSL_Tab
});

var TrackerSSL_RequestController = function(req){
  var tab;
  var has_applicable_ruleset;
  var tabid = req.tabId;
  var type = req.type;
  var activeURL = new URI(req.url)
  var activeTab = TrackerSSL_CurrentTabCollection.get(tabid);
  var url;
  var https_laggards = 0;
  var uniqueHosts = [];

  // Normalise hosts such as "www.example.com."
  // From EFF's HTTPS Everywhere
  var canonical_host = activeURL.hostname();
  if (canonical_host.charAt(canonical_host.length - 1) == ".") {
    while (canonical_host.charAt(canonical_host.length - 1) == ".")
      canonical_host = canonical_host.slice(0,-1);
    activeURL.hostname(canonical_host);
  }

  url = new TrackerSSL_Request({
    hostname: activeURL.hostname(),
    path: activeURL.path(),
    protocol: activeURL.protocol(),
    href: activeURL.href()
  });

  // Check if this is a new page
  if(type === "main_frame"){
    // Check if we have an ongoing record for this tab
    tab = TrackerSSL_CurrentTabCollection.get(tabid);
    if(typeof tab !== "undefined"){
      // we have a record, but we're on a new page, so let's refresh
      tab.reset();
    }
    else{
      // create a new record
      tab = new TrackerSSL_Tab({tabid: tabid})
      TrackerSSL_CurrentTabCollection.add(tab)
    }
    // add this request as the current URL for the tab
    tab.set('url', url);
    console.log("new page loaded at: " + url.get('hostname'));
  } 
  else{
    // check if tabid exists in current records 
    tab = TrackerSSL_CurrentTabCollection.get(tabid);
    if(typeof tab !== "undefined"){
      url.thirdPartyChecker(
        tab.get('url').get('hostname')
      );
      if(url.get('isThirdParty')){

        // Check for SSL support
        // console.log(url.get('protocol'));
        has_applicable_ruleset = HTTPS_Everwhere_onBeforeRequest(req);
        if(has_applicable_ruleset || url.get('protocol') === "https"){
          // console.log("HTTPS Everhwhere ruleset found");
          url.set('httpsing', true);
          // check if ruleset redirect 200 OKs?
        }
        else{
          url.set('httpsing', false);
          // Special actions for insecure 3rd party transfers?  
        }
        tab.get('url').get('requests').add(url);

        // Get Unique requests
        uniqueHosts = _.uniq(tab.get('url').get('requests').pluck('hostname'));
        urls_supporting_https = tab.get('url').get('requests').where({'httpsing': true});
        urls_not_supporting_https = tab.get('url').get('requests').where({'httpsing': false});
        console.log(uniqueHosts);
        console.log(urls_supporting_https);
        if(urls_supporting_https[0]){
          uniqueRulesetHosts = _.uniq(new TrackerSSL_TabCollection(urls_supporting_https).pluck('hostname'));
          uniqueNonRulesetHosts = _.uniq(new TrackerSSL_TabCollection(urls_not_supporting_https).pluck('hostname'));
        }
        else{
          uniqueRulesetHosts = [];
        }
        percentageSSL = Math.floor(uniqueRulesetHosts.length / uniqueHosts.length * 100);

        // uniqueRulesetRequests = _.uniq(tab.get('url').get('requests').where({'https_ruleset': true}));
        https_laggards = uniqueHosts.length - uniqueRulesetHosts.length;
      }

      // Analyze cookies

      // console.log("Request made from page", url.get('isThirdParty'), req);
      tab.get('url').set('badTrackers', uniqueNonRulesetHosts);
      tab.get('url').set('goodTrackers', uniqueRulesetHosts);
      tab.get('url').set('uniqueHosts', uniqueHosts);
      tab.get('url').set('percentageSSL', percentageSSL);

      activeTab.updateIconCounter(percentageSSL +  "%");
      console.log(tab.get('tabid'));
      chrome.runtime.sendMessage({
        'tab': tab.get('tabid'),
        'goodURL': uniqueRulesetHosts,
        'badURL': uniqueNonRulesetHosts,
        'percentageSSL': percentageSSL,
        'uniqueHosts': uniqueHosts
      }, function(response) {
        console.log(response);
      });
    }
    else{
      // TODO FIX THIS
      throw(new Error("Request made from tab that was opened before extension initialized"));
    }
  }
};

var tabMessageController = function(message, sender, sendResponse) {
  var activeTab = TrackerSSL_CurrentTabCollection.get(message.tab);
  if(activeTab){
    chrome.runtime.sendMessage({
        'tab': message.tab,
        'goodURL': activeTab.get('url').get('goodTrackers'),
        'badURL': activeTab.get('url').get('badTrackers'),
        'percentageSSL': activeTab.get('url').get('percentageSSL'),
        'uniqueHosts': activeTab.get('url').get('uniqueHosts')
      }, function(response) {
        console.log(response);
      });
  }
}

// TODO load historical collection of url-tracker pairs from localstorage at init
// var TrackerSSL_HistoryCollection;

var TrackerSSL_CurrentTabCollection = new TrackerSSL_TabCollection();

chrome.webRequest.onBeforeRequest.addListener(
  TrackerSSL_RequestController,
  {
    urls: ['http://*/*', 'https://*/*']
  }
  , ["blocking"]
);

chrome.runtime.onMessage.addListener(tabMessageController);

// chrome.tabs.onUpdated.addListener(TrackerSSL_TabController);

