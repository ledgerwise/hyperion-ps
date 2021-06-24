require('dotenv').config();
const { EventEmitter } = require('events');
const axios = require('axios').default;
const logger = require('./src/logger')({
  //filename: 'indexer.log',
  loglabel: 'hyperion-ps',
});

if (process.env.NODE_ENV === 'development') logger.level = 'debug';

const axiosConfig = {
  timeout: 10000,
};
class HPSC extends EventEmitter {
  last_global_sequence = 0;

  constructor({
    endpoints = [],
    fetchEndpointList = true,
    chainId,
    startBlock = 0,
    fetchDeltas = false,
    account,
    name,
    loopWait = 10,
    healthLoops = 35,
    simpleActions = false,
    queryLimit = 100,
  }) {
    super();
    this.loopCounter = 0;
    this.endpoints = endpoints;
    this.fetchEndpointList = fetchEndpointList;
    this.chainId = chainId;
    this.healthyEndpoints = [];
    this.loopWait = loopWait * 1000;
    this.loops = 0;
    this.healthLoops = healthLoops;
    this.nextBlock = startBlock;
    this.account = account;
    this.name = name;
    this.simpleActions = simpleActions;
    this.queryLimit = queryLimit;
  }

  async fetchEndpoints() {
    const url = `https://api.ledgerwise.io/apps/nodestatus/${this.chainId}.json`;
    logger.debug(`Fetching endpoints from ${url}`);
    try {
      const response = await axios.get(url, axiosConfig);
      if (response.status !== 200)
        throw `response.status.code response.status.text`;
      return [
        ...new Set(
          response.data.healthy_hyperion_endpoints.filter((e) =>
            e.startsWith('https')
          )
        ),
      ];
    } catch (error) {
      logger.error(`Error fetching endpoints: ${error}`);
    }
    return null;
  }

  async checkEndpointsHealth() {
    const result = await Promise.all(
      this.endpoints.map(async (endpoint) => {
        const url = `${endpoint}/v2/health`;
        let response;
        try {
          response = await axios.get(url, axiosConfig);
        } catch (error) {
          console.error('Error fetching endpoint health', error);
        }
        if (!response)
          return {
            host: '',
            status: false,
          };
        const servicesOk =
          response.data.health.filter((i) => i.status !== 'OK').length == 0;
        const featuresOk =
          response.data.features.index_deltas &&
          response.data.features.index_all_deltas &&
          response.data.features.index_transfer_memo;
        const elasticService = response.data.health.filter(
          (i) => i.service === 'Elasticsearch'
        );
        const indicesOk =
          elasticService?.service_data?.last_indexed_block ===
            elasticService?.service_data?.total_indexed_blocks &&
          elasticService?.service_data?.last_indexed_block !== null;
        const currentTime = Date.now();
        const timeOk =
          response.data.health.filter(
            (i) => Math.abs(i.time - currentTime) > this.loopWait
          ).length == 0;

        const status = servicesOk && featuresOk && indicesOk && timeOk;
        logger.debug(
          `${response.data.host} ${status} services: ${servicesOk} features: ${featuresOk} indices: ${indicesOk} time: ${timeOk}`
        );
        return {
          host: response.data.host,
          status: status,
        };
      })
    );
    return result
      .filter((e) => e.status && e.host != '0.0.0.0:7000')
      .map((e) => `https://${e.host}`);
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  randomEndpoint() {
    return this.healthyEndpoints[
      Math.floor(Math.random() * this.healthyEndpoints.length)
    ];
  }

  async fetchActions() {
    const url = `${this.randomEndpoint()}/v2/history/get_actions?account=${
      this.account
    }&block_num=${this.nextBlock}-100000000000&limit=${
      this.queryLimit
    }&noBinary=false&simple=${this.simpleActions}&sort=asc`;
    logger.debug(`Getting actions: ${url}`);
    try {
      const response = await axios.get(url, axiosConfig);
      if (this.simpleActions) return response.data.simple_actions;
      else return response.data.actions;
    } catch (error) {
      logger.error(error);
      return [];
    }
  }

  async start() {
    if (this.fetchEndpointList) {
      const fetchedEndpoints = await this.fetchEndpoints();
      if (fetchedEndpoints) this.endpoints = fetchedEndpoints;
    }

    while (true) {
      //Check endpoints health
      if (this.loops % this.healthLoops === 0)
        this.healthyEndpoints = await this.checkEndpointsHealth();
      if (this.healthyEndpoints.length) {
        logger.debug(`Healthy endpoints: ${this.healthyEndpoints}`);
      } else {
        logger.error(`No healthy endpoints found`);
        await this.sleep(this.loopWait);
        continue;
      }

      //Get actions
      const actions = await this.fetchActions();
      this.emit('successful_query');
      const filtered_actions = actions.filter(
        (action) => action.global_sequence > this.last_global_sequence
      );
      logger.debug(`Got ${filtered_actions.length} new actions to process`);
      if (filtered_actions.length) {
        this.emit('actions', filtered_actions);
        this.last_global_sequence =
          filtered_actions[filtered_actions.length - 1].global_sequence;
        if (this.simpleActions)
          this.nextBlock = filtered_actions[filtered_actions.length - 1].block;
        else
          this.nextBlock =
            filtered_actions[filtered_actions.length - 1].block_num;
      }

      this.loops++;
      await this.sleep(this.loopWait);
    }
  }
}

module.exports = HPSC;

// const client = new HPSC({
//   endpoints: ['https://testnet.wax.pink.gg', 'https://testnet.waxsweden.org'],
//   fetchEndpointList: false,
//   chainId: 'f16b1833c747c43682f4386fca9cbb327929334a762755ebec17f6f23c9b8a12',
//   startBlock: 0,
//   fetchDeltas: false,
//   account: 'certifydlwse',
//   name: null,
// });

// logger.info('Starting client');
// client.start();
// client.on('actions', (actions) => {
//   for (const action of actions) {
//     logger.debug(
//       `${action.block_num} ${action.global_sequence} ${action.timestamp} ${action.act.name}`
//     );
//   }
// });
